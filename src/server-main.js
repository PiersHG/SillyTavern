// native node modules
import path from 'node:path';
import util from 'node:util';
import net from 'node:net';
import dns from 'node:dns';
import process from 'node:process';

import cors from 'cors';
import { csrfSync } from 'csrf-sync';
import express from 'express';
import compression from 'compression';
import cookieSession from 'cookie-session';
import multer from 'multer';
import responseTime from 'response-time';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import open from 'open';

import './fetch-patch.js';
import { serverDirectory } from './server-directory.js';

console.log(`Node version: ${process.version}. Running in ${process.env.NODE_ENV} environment. Server directory: ${serverDirectory}`);

if (process.versions && process.versions.node && process.versions.node.match(/20\.[0-2]\.0/)) {
    if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(false);
}

import { serverEvents, EVENT_NAMES } from './server-events.js';
import { loadPlugins } from './plugin-loader.js';
import {
    initUserStorage,
    getCookieSecret,
    getCookieSessionName,
    ensurePublicDirectoriesExist,
    getUserDirectoriesList,
    migrateSystemPrompts,
    migrateUserData,
    requireLoginMiddleware,
    setUserDataMiddleware,
    shouldRedirectToLogin,
    cleanUploads,
    getSessionCookieAge,
    verifySecuritySettings,
    loginPageMiddleware,
} from './users.js';

import getWebpackServeMiddleware from './middleware/webpack-serve.js';
import basicAuthMiddleware from './middleware/basicAuth.js';
import getWhitelistMiddleware from './middleware/whitelist.js';
import accessLoggerMiddleware, { getAccessLogPath, migrateAccessLog } from './middleware/accessLogWriter.js';
import multerMonkeyPatch from './middleware/multerMonkeyPatch.js';
import initRequestProxy from './request-proxy.js';
import getCacheBusterMiddleware from './middleware/cacheBuster.js';
import corsProxyMiddleware from './middleware/corsProxy.js';
import {
    getVersion,
    color,
    removeColorFormatting,
    getSeparator,
    safeReadFileSync,
    setupLogLevel,
    setWindowTitle,
} from './util.js';
import { UPLOADS_DIRECTORY } from './constants.js';
import { ensureThumbnailCache } from './endpoints/thumbnails.js';

import { router as usersPublicRouter } from './endpoints/users-public.js';
import { init as statsInit, onExit as statsOnExit } from './endpoints/stats.js';
import { checkForNewContent } from './endpoints/content-manager.js';
import { init as settingsInit } from './endpoints/settings.js';
import { redirectDeprecatedEndpoints, ServerStartup, setupPrivateEndpoints } from './server-startup.js';
import { diskCache } from './endpoints/characters.js';

util.inspect.defaultOptions.maxArrayLength = null;
util.inspect.defaultOptions.maxStringLength = null;
util.inspect.defaultOptions.depth = 4;

const cliArgs = globalThis.COMMAND_LINE_ARGS;

if (!cliArgs.enableIPv6 && !cliArgs.enableIPv4) {
    console.error('error: You can\'t disable all internet protocols: at least IPv6 or IPv4 must be enabled.');
    process.exit(1);
}

try {
    if (cliArgs.dnsPreferIPv6) {
        dns.setDefaultResultOrder('ipv6first');
        console.log('Preferring IPv6 for DNS resolution');
    } else {
        dns.setDefaultResultOrder('ipv4first');
        console.log('Preferring IPv4 for DNS resolution');
    }
} catch (error) {
    console.warn('Failed to set DNS resolution order. Possibly unsupported in this Node version.');
}

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(responseTime());
app.use(bodyParser.json({ limit: '200mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '200mb' }));

const CORS = cors({ origin: 'null', methods: ['OPTIONS'] });
app.use(CORS);

cliArgs.whitelistMode = false;

if (cliArgs.listen && cliArgs.basicAuthMode) {
    app.use(basicAuthMiddleware);
}

if (cliArgs.whitelistMode) {
    const whitelistMiddleware = await getWhitelistMiddleware();
    app.use(whitelistMiddleware);
}

if (cliArgs.listen) {
    app.use(accessLoggerMiddleware());
}

if (cliArgs.enableCorsProxy) {
    app.use('/proxy/:url(*)', corsProxyMiddleware);
} else {
    app.use('/proxy/:url(*)', async (_, res) => {
        const message = 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.';
        console.log(message);
        res.status(404).send(message);
    });
}

app.use(cookieSession({
    name: getCookieSessionName(),
    sameSite: 'lax',
    httpOnly: true,
    maxAge: getSessionCookieAge(),
    secret: getCookieSecret(cliArgs.dataRoot, cliArgs.cookieSecretFile),
}));

app.use(setUserDataMiddleware);

if (!cliArgs.disableCsrf) {
    const csrfSyncProtection = csrfSync({
        getTokenFromState: (req) => req.session?.csrfToken,
        getTokenFromRequest: (req) => req.headers['x-csrf-token']?.toString(),
        storeTokenInState: (req, token) => { if (req.session) req.session.csrfToken = token; },
        size: 32,
    });

    app.get('/csrf-token', (req, res) => {
        res.json({ token: csrfSyncProtection.generateToken(req) });
    });

    csrfSyncProtection.invalidCsrfTokenError.message = color.red('Invalid CSRF token. Please refresh the page and try again.');
    csrfSyncProtection.invalidCsrfTokenError.stack = undefined;

    app.use(csrfSyncProtection.csrfSynchronisedProtection);
} else {
    console.warn('\nCSRF protection is disabled. This will make your server vulnerable to CSRF attacks.\n');
    app.get('/csrf-token', (req, res) => {
        res.json({ token: 'disabled' });
    });
}

app.get('/', getCacheBusterMiddleware(), (req, res) => {
    if (shouldRedirectToLogin(req)) {
        const query = req.url.split('?')[1];
        const redirectUrl = query ? `/login?${query}` : '/login';
        return res.redirect(redirectUrl);
    }
    return res.sendFile('index.html', { root: path.join(serverDirectory, 'public') });
});

app.get('/callback/:source?', (req, res) => {
    const source = req.params.source;
    const query = req.url.split('?')[1];
    const searchParams = new URLSearchParams();
    source && searchParams.set('source', source);
    query && searchParams.set('query', query);
    const path = `/?${searchParams.toString()}`;
    return res.redirect(307, path);
});

app.get('/login', loginPageMiddleware);

const webpackMiddleware = getWebpackServeMiddleware();
app.use(webpackMiddleware);
app.use(express.static(path.join(serverDirectory, 'public')));

app.use('/api/users', usersPublicRouter);

app.use(requireLoginMiddleware);
app.post('/api/ping', (req, res) => {
    if (req.query.extend && req.session) req.session.touch = Date.now();
    res.sendStatus(204);
});

const uploadsPath = path.join(cliArgs.dataRoot, UPLOADS_DIRECTORY);
app.use(multer({ dest: uploadsPath, limits: { fieldSize: 10 * 1024 * 1024 } }).single('avatar'));
app.use(multerMonkeyPatch);

app.get('/version', async (_, res) => {
    const data = await getVersion();
    res.send(data);
});

redirectDeprecatedEndpoints(app);
setupPrivateEndpoints(app);

function apply404Middleware() {
    const notFoundWebpage = safeReadFileSync(path.join(serverDirectory, 'public/error/url-not-found.html')) ?? '';
    app.use((req, res) => res.status(404).send(notFoundWebpage));
}

let serverPort = process.env.PORT || 5000;

export function setPort(port) {
    serverPort = port;
}

await initUserStorage(globalThis.DATA_ROOT)
    .then(ensurePublicDirectoriesExist)
    .then(migrateUserData)
    .then(migrateSystemPrompts)
    .then(verifySecuritySettings)
    .then(apply404Middleware)
    .then(() => new ServerStartup(app, cliArgs).start())
    .then(() => {
        const PORT = process.env.PORT || serverPort || 5000;
        app.listen(PORT, () => {
            console.log(`\n✅ SillyTavern is listening on port ${PORT}\n`);
        });
    })
    .catch((error) => {
        console.error('❌ Server startup failed:', error);
    });

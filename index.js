#!/usr/bin/env node
var fs = require('fs'),
  connect = require('connect'),
  colors = require('colors'),
  WebSocket = require('faye-websocket'),
  path = require('path'),
  url = require('url'),
  http = require('http'),
  http2 = require('spdy'),
  send = require('send'),
  open = require('open'),
  es = require("event-stream"),
  watchr = require('watchr'),
  chokidar = require('chokidar'),
  httpProxy = require('http-proxy'),
  zlib = require('zlib'),
  ws,
  clients = [];

var INJECTED_CODE = "<script>" + fs.readFileSync(__dirname + "/injected.js", "utf8") + "</script>";

var LiveServer = {};

function escape(html) {
  return String(html)
    .replace(/&(?!\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Based on connect.static(), but streamlined and with added code injecter
function staticServer(root, html5mode) {
  return function (req, res, next) {
    if ('GET' != req.method && 'HEAD' != req.method) return next();
    var reqpath = url.parse(req.url).pathname;
    if (html5mode && !reqpath.match(/\./)) {
      req.url = reqpath = "/200.html"
    }
    var hasNoOrigin = !req.headers.origin;
    var doInject = false;

    function directory() {
      var pathname = url.parse(req.originalUrl).pathname;
      res.statusCode = 301;
      res.setHeader('Location', pathname + '/');
      res.end('Redirecting to ' + escape(pathname) + '/');
    }

    function file(filepath, stat) {
      var x = path.extname(filepath);
      if (hasNoOrigin && (x === "" || x == ".html" || x == ".htm" || x == ".xhtml" || x == ".php")) {
        // TODO: Sync file read here is not nice, but we need to determine if the html should be injected or not
        var contents = fs.readFileSync(filepath, "utf8");
        doInject = contents.indexOf("</body>") > -1;
      }
    }

    function error(err) {
      if (404 == err.status) return next();
      next(err);
    }

    function inject(stream) {
      if (doInject) {
        // We need to modify the length given to browser
        var len = INJECTED_CODE.length + res.getHeader('Content-Length');
        res.setHeader('Content-Length', len);
        var originalPipe = stream.pipe;
        stream.pipe = function (res) {
          originalPipe.call(stream, es.replace(new RegExp("</body>", "i"), INJECTED_CODE + "</body>")).pipe(res);
        };
      }
    }

    send(req, reqpath, {root: root})
      .on('error', error)
      .on('directory', directory)
      .on('file', file)
      .on('stream', inject)
      .pipe(res);
  };
}

/**
 * Start a live server with parameters given as an object
 * @param host {string} Address to bind to (default: 0.0.0.0)
 * @param port {number} Port number (default: 8080)
 * @param root {string} Path to root directory (default: cwd)
 * @param open {string} Subpath to open in browser, use false to suppress launch (default: server root)
 * @param logLevel {number} 0 = errors only, 1 = some, 2 = lots
 */
LiveServer.start = function (options) {
  options = options || {};
  var host = options.host || '0.0.0.0';
  var port = options.port || 8080;
  var root = options.root || process.cwd();
  var inclExtensions = options.inclExtensions || []
  var exclExtensions = options.exclExtensions || []
  var logLevel = options.logLevel === undefined ? 2 : options.logLevel;
  var openPath = (options.open === undefined || options.open === true) ?
    "" : ((options.open === null || options.open === false) ? null : options.open);
  if (options.noBrowser) openPath = null; // Backwards compatibility with 0.7.0
  var html5mode = fs.existsSync(root + "/200.html")
  if (html5mode) {
    console.log(("200.html detected, serving it for all URLs that have no '.' (html5mode)").yellow)
  }

  var server;
  // Setup a web server
  if (!options.proxyServer) {
    var app = connect()
      .use(staticServer(root, html5mode)) // Custom static server
      .use(connect.directory(root, {icons: true}));
    if (logLevel >= 2)
      app.use(connect.logger('dev'));

    if (options.useHttp2) {
      var serverOptions = {
        key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAy1Mogi0sHpx/rCQ3jJDuNTAVa4IjfnGWGkYKttNnNd2Zyjf6\npa+fJlOjLghSlnB4uDZCSVWLrjLAIGZopqxQ3jNSQDFyGaDGBFkVJ+u7qxzt/2MC\nlJt6aosyruCwSdcIxWnLLB3DCt43/juCWAnK/7sGpOV9CySJy7jRx7XQmPeF+EqL\nfWTP+9r8vqLfpFmz5mNetHwACGknjegQPzh/+tu4+xKIst1uPJFhJ694vNcPtLfr\nsWc2sE+pWApjfg7Ak6jMSG3LgvGZkmj5CXeEUuZ47mWLGo2MqgtQaUJrVP3zFtGM\nafP7HmEASIYPRQ1YHxxZfsSlhckoQDgkwOWXQQIDAQABAoIBAQCN5xTPfY1cM+cb\nEg++x+uoLU3VwXbaKZYT8ixKGtLekjFiI52IA0D0s8ygNOjG2+o0zpGGsvCQfBUA\nx9hj8sFhwrm12YyDfGSW5kFQokJRExi7c7N6WeSe9VVDHceLUUtq1AIbYQ4dyKeV\nhJzcqsEFp9bkQNH7c93D09J9KlRSXLa+dwVGampOfYrc0KHJUrcx9k2ge3gr26fm\nmV1vBi7+k1bADmQZjeJMCzAtpnWLHVeaukVayN9WkBi13jbasAceF/TtgGuozQp4\nnLEj9+5TZD+U8izExJlZTjjBOfHSgvcgPHs8PqUK6IiRvtdneaA6hItBjGkQIH+3\ngzuDjv0dAoGBANNo/zzuD114kF5TnupH0MNlCFaaZC5NC75SzbbVpDWyQ2wjZdrp\n9zVX0IAT7+c7ncjrtExs+fiWxYiarBkBf+DCXDpMQKcImsfSOjUvtLQO4/621plr\nJx9oz8PdtWEzcXlDHCghuNmY6EEJkpOF+eKis6eIEv2FcML2L2+BbNCbAoGBAPY1\nmS9DyC5l8RlNng0MUPeCSCqi7tQ3EfcXITMky2oncqF1/s7XPpOwJn20KkvGQ1do\nZ81KeF5hc+DeBBG9SDxoWvzppf3QEGb8Glwfsd0/s8/k+IV6q0CKhwM+RQR24DP7\nMRrHU+bLebOTHEpDA2iRPf9DUBSuLbbJY0oOTK9TAoGAOoXQUi+cdUWQwWvoi/ZB\nZjWrrz2iCecuHwuRAtH1WR/15hOOeKFX255pi2r5eEtajGojSRzJvfUOzZfzmCCA\nI9np6gF9zD9niXU6w8pm/Yk5uCMpGOM+u0UqbpALS9MP0H+xZbKgFyxq7sYVm1z1\nJbXggbn7d87evjmkO/vaAY0CgYAp/lZUU3FPSJ/ouu5cN1+P966rZwLpO0NbK5zE\nBmCTiIrqsx901A2eTwshoZsdNYHC5NHfl/YT0vdawUNcazZo5zutq4ReWCCUECfG\n0rkZjYXzzY/95EBVT8tbaEGJU2VGOG/Vq23KDaaCVHMcz3VDXpJ+eVKtVFADvzGq\nLeoydQKBgDlApjgsdfiBXOW2ThJHPx5VSMsCO8GkiWJQm+fq79xAZ7IBhY0mdLwO\nTnkZErQfvqPzgM9rr/eYZf4+Ul8xtkDa8jHuR8UZntVcMy28ck+s0OSIbPE1V9RE\nAuc1nfe4g3hQVrdHeyCHcOGZSZgFfOfW1s1qhVY/sjEMnzCPsWV6\n-----END RSA PRIVATE KEY-----",
        cert: "-----BEGIN CERTIFICATE-----\nMIICwjCCAaygAwIBAgIDAQABMAsGCSqGSIb3DQEBCzAXMRUwEwYDVQQDFgx0ZXN0\nLmluZHV0bnkwHhcNMTUwODEyMDMzNzQ1WhcNMjUwODEwMDMzNzQ1WjAXMRUwEwYD\nVQQDFgx0ZXN0LmluZHV0bnkwggEgMAsGCSqGSIb3DQEBAQOCAQ8AMIIBCgKCAQEA\ny1Mogi0sHpx/rCQ3jJDuNTAVa4IjfnGWGkYKttNnNd2Zyjf6pa+fJlOjLghSlnB4\nuDZCSVWLrjLAIGZopqxQ3jNSQDFyGaDGBFkVJ+u7qxzt/2MClJt6aosyruCwSdcI\nxWnLLB3DCt43/juCWAnK/7sGpOV9CySJy7jRx7XQmPeF+EqLfWTP+9r8vqLfpFmz\n5mNetHwACGknjegQPzh/+tu4+xKIst1uPJFhJ694vNcPtLfrsWc2sE+pWApjfg7A\nk6jMSG3LgvGZkmj5CXeEUuZ47mWLGo2MqgtQaUJrVP3zFtGMafP7HmEASIYPRQ1Y\nHxxZfsSlhckoQDgkwOWXQQIDAQABox0wGzAZBgNVHREEEjAQgg4qLnRlc3QuaW5k\ndXRueTALBgkqhkiG9w0BAQsDggEBAGYNi5CCq+/YmzH2Z7fgQ30oRdwvbn3MlM1F\nTrX33V+7Uu8bccABIrTXfOpWRMqREeygx4GvbffMvR1CnFGG5mxIEqaSSM9mBEBZ\nymlxiej6yCHAvPb3aG73Aa/bs55beOpXmRsMU3Ix9QhJzWOY6JDN0OBdSEuBBimE\n4jEnQOYczARbLKZJe7MenNo6dD7OKiwJGCFZBWFeCZBflqDm+HA5rUpG7EOi3Rr+\nGIABvRn+y0u4eVeEJBN4rWzNiMv44CD55PrbbNq9OQVIS3NmFScl4tQFDb0fgAdb\nR0ZtujqDjMY3uZZxtiu6CmBTUKhwF3tTn5sMV4Y6ZR9RgT/UEuQ=\n-----END CERTIFICATE-----",
      };
      server = http2.createServer(serverOptions, app).listen(port, host);
    } else {
      server = http.createServer(app).listen(port, host);
    }

  } else {
    // set up the proxy server
    var proxy = httpProxy.createProxyServer({
      target: options.proxyServer
    });

    // set up a connect server to install middleware, which will be used by the proxy server
	server = connect()
      .use(function(req, res, next) {
        var _write = res.write;
        var _writeHead = res.writeHead;

        var isHTML;

        // disable any compression
        req.headers['accept-encoding'] = 'identity';

        // set up the headers so that injection works correctly
        res.writeHead = function(code, headers) {
          var cEnc = res.getHeader('content-encoding');
          var cType = res.getHeader('content-type');
          var cLen = res.getHeader('content-length');
          isHTML = cType && cType.match('text/html');

          if (isHTML) {
			res.setHeader('content-length', parseInt(cLen) + INJECTED_CODE.length);
          }

          _writeHead.apply(this, arguments);
        }

        // perform the actual injection if the chunk is html
        res.write = function(chunk) {
          function inject(body) {
            return body.toString().replace(new RegExp('</body>', 'i'), INJECTED_CODE + '</body>');
          }

          _write.call(res, isHTML ? inject(chunk) : chunk);
        }

        next();
      })
      .use(function(req, res) {
        proxy.web(req, res);
      })
      .listen(options.port || 8080)
      .on('error', console.log.bind(console));
  }

  // WebSocket
  server.addListener('upgrade', function (request, socket, head) {
    var ws = new WebSocket(request, socket, head);
    ws.onopen = function () {
      ws.send(JSON.stringify({type: 'connected'}));
    };
    clients.push(ws)
  });

  // Setup file watcher
  chokidar.watch(root, {
    ignored: /([\/\\]\.)|(node_modules)/,
    ignoreInitial: true,
    ignorePermissionErrors: true
  }).on('all', function (event, filePathOrErr) {
    if (event == 'error') {
      console.log("ERROR:".red, filePathOrErr);
    } else {
      var relativePath = path.relative(root, filePathOrErr);
      if (logLevel >= 1) console.log(("Change detected: " + relativePath).cyan);

      if(exclExtensions.length > 0 && exclExtensions.indexOf(path.extname(relativePath).replace(/\./g, '')) > -1) {
        return false
      }

      if(inclExtensions.length > 0 && inclExtensions.indexOf(path.extname(relativePath).replace(/\./g, '')) < 0) {
        return false
      }

      clients.forEach( function ( ws ) {
        ws.send(JSON.stringify({type: 'change', path: relativePath}))
      })
    }
  });

  // Output
  if (logLevel >= 1) {
    if (!options.proxyServer) {
      var serveURL = url.format({
        protocol: options.useHttp2 ? 'https' : 'http',
        hostname: '127.0.0.1',
        port: port
      });
      console.log(('Serving "' + root + '" at ' + serveURL).green);
    } else {
      console.log(('Starting a proxy server for ' + options.proxyServer + ' at ' + 'http://localhost:' + options.port).green);
    }
  }

  // Launch browser
  if (openPath !== null)
    open(serveURL + openPath);
};

module.exports = LiveServer;

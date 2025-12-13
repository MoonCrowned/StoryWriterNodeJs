const url = require('url');
const openRouterService = require('./service');

function sendJson(res, data, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        if (!body) resolve({});
        else resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const parsedUrl = url.parse(req.url);
  const pathname = decodeURIComponent(parsedUrl.pathname || '/');

  if (pathname === '/api/openrouter/text' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const result = await openRouterService.generateText(body.model, body.prompt);
      sendJson(res, result);
    } catch (err) {
      sendJson(res, { success: false, error: err.message || 'Server Error' }, 500);
    }
    return true;
  }

  if (pathname === '/api/openrouter/image' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const result = await openRouterService.generateImage(body.model, body.prompt, body.aspectRatio);
      sendJson(res, result);
    } catch (err) {
      sendJson(res, { success: false, error: err.message || 'Server Error' }, 500);
    }
    return true;
  }

  return false;
}

module.exports = { handle };

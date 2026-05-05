const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const distDir = '/app/repo/widget/dist';

app.use(
  '/api',
  createProxyMiddleware({
    target: 'http://sarah-backend:3000/api',
    changeOrigin: false,
    ws: true,
    pathRewrite: {
      '^/api': '',
    },
  }),
);

app.use(express.static(distDir));
app.use((req, res) => res.sendFile(`${distDir}/index.html`));

app.listen(8080, '0.0.0.0');

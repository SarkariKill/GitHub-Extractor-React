import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { createProxyMiddleware } from "http-proxy-middleware";
import router from "./routes";
import { logger } from "./lib/logger";

const FASTAPI_PORT = process.env["FASTAPI_PORT"] || "8000";
const FASTAPI_TARGET = `http://localhost:${FASTAPI_PORT}`;

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

app.use(
  createProxyMiddleware({
    target: FASTAPI_TARGET,
    changeOrigin: true,
    pathFilter: "/api/v1",
    on: {
      error: (err, _req, res) => {
        logger.error({ err }, "Proxy error forwarding to FastAPI");
        if (!res.headersSent) {
          (res as express.Response).status(502).json({ detail: "Backend unavailable" });
        }
      },
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;

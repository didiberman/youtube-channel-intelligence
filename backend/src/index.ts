import express from "express";
import { ZodError } from "zod";
import { apiRouter, internalRouter } from "./routes.js";
import { telegramRouter } from "./telegram-webhook.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});
app.use("/api", apiRouter);
app.use("/internal", internalRouter);
app.use("/telegram", telegramRouter);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: error.issues.map((issue) => issue.message).join(", "),
      });
      return;
    }
    console.error(error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  },
);

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

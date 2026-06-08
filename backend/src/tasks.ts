import { CloudTasksClient } from "@google-cloud/tasks";
import { Timestamp } from "firebase-admin/firestore";
import { config } from "./config.js";

const client = new CloudTasksClient();
const retryDelaySeconds = 2 * 60 * 60;

export async function scheduleTranscriptRetry(
  channelId: string,
  videoId: string,
) {
  if (!config.schedulerAudience || !config.schedulerServiceAccount) {
    throw new Error("Cloud Tasks callback configuration is incomplete");
  }

  const parent = client.queuePath(
    config.projectId,
    config.tasksLocation,
    config.tasksQueue,
  );
  const runAt = Timestamp.fromMillis(Date.now() + retryDelaySeconds * 1_000);
  const body = Buffer.from(JSON.stringify({ channelId, videoId })).toString(
    "base64",
  );

  await client.createTask({
    parent,
    task: {
      scheduleTime: {
        seconds: runAt.seconds,
        nanos: runAt.nanoseconds,
      },
      httpRequest: {
        httpMethod: "POST",
        url: `${config.schedulerAudience}/internal/retry`,
        headers: { "Content-Type": "application/json" },
        body,
        oidcToken: {
          serviceAccountEmail: config.schedulerServiceAccount,
          audience: config.schedulerAudience,
        },
      },
    },
  });

  return runAt;
}



const axios = require("axios");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);
async function sendMattermostNotification({
  webhookUrl,
  title = "📝 Notification",
  message = "",
  status = "success", // success | error | info
  fields = [],
}) {
  try {
    const color = {
      success: "#00c853",
      error: "#d32f2f",
      info: "#0288d1",
    }[status] || "#0288d1";

    const payload = {
      attachments: [
        {
          fallback: `${title}: ${message}`,
          color,
          title,
          text: message,
          fields,
          footer: "Automated System",
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    await axios.post(webhookUrl, payload);
    console.log("✅ Mattermost notification sent.", message);
  } catch (error) {
    console.error("🚨 Failed to send Mattermost notification:", error.message);
  }
}

/**
 * @param {Array} configArray        report jobs that actually ran
 * @param {Array} failedUsers
 * @param {Array} skippedUsers       ran, but the platform returned no data
 * @param {Array} [alreadySyncedUsers] credentials NOT run because they had
 *        already synced today. These never enter configArray — without listing
 *        them here the report silently under-reports scope, and a run where
 *        everything was skipped would look like it never happened.
 *        Shape: { username, trackVidEmail, lastSync? }
 */
function formatSummaryTable(configArray, failedUsers, skippedUsers, alreadySyncedUsers = []) {
  const timestamp = dayjs().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  let message = `🗓️ **Script Execution Summary - ${timestamp}**\n\n`;
  message += `| # | Username | Email | Report Type | Status |\n`;
  message += `|---|----------|-------|--------------|--------|\n`;

  const matchUser = (f, u) => f.username === u.username && f.reportType === u.reportType && f.companyId?.toString() === u.companyId?.toString();

  configArray.forEach((user, index) => {
    const failedEntry = failedUsers.find(f => matchUser(f, user));
    const skippedEntry = skippedUsers.find(s => matchUser(s, user));

    let status = "✅ Success";

    if (failedEntry?.reason === "password_changed") {
      status = "🔒 Password Changed";
    } else if (failedEntry) {
      status = "❌ Failed";
    } else if (skippedEntry) {
      status = "⚠️ Skipped (No data for that date)";
    }

    message += `| ${index + 1} | ${user.username} | ${user.trackVidEmail} | ${user.reportType} | ${status} |\n`;
  });

  // Credentials that were in scope but never ran because they had already
  // synced today. Listed after the executed rows, numbering continued, so the
  // table still accounts for every credential the run considered.
  alreadySyncedUsers.forEach((user, i) => {
    const when = user.lastSync
      ? dayjs(Number(user.lastSync) || user.lastSync).tz("Asia/Kolkata").format("hh:mm A")
      : null;

    message += `| ${configArray.length + i + 1} | ${user.username} | ${user.trackVidEmail || "—"} | — | ⏭️ Skipped (already synced${when ? ` at ${when}` : " today"}) |\n`;
  });

  // Add error details section if there are failed users
  if (failedUsers.length > 0) {
    message += `\n---\n\n`;
    message += `🚨 **Error Details:**\n\n`;

    failedUsers.forEach((failed, index) => {
      const errorMsg = failed.error || "Unknown error";
      const truncatedError = errorMsg.length > 150 ? errorMsg.substring(0, 150) + "..." : errorMsg;
      message += `**${index + 1}. ${failed.username}** (${failed.reportType})\n`;
      message += `> ${truncatedError}\n\n`;
    });
  }

  return message;
}

/**
 * Post a message with a FILE attached, using a bot account rather than a webhook.
 *
 * A webhook cannot upload — `sendMattermostNotification` above can only post
 * text — so a report that is a spreadsheet needs the two-step Files API:
 *
 *   1. POST /api/v4/files?channel_id=…  (multipart)  -> file id
 *   2. POST /api/v4/posts { channel_id, message, file_ids }
 *
 * Credentials are PARAMETERS, never read from the environment here. The desktop
 * app posts its own bulk-claim report, and a bot token compiled into a shipped
 * binary is a token handed to every machine it is installed on — so the caller
 * passes one it fetched at runtime for the signed-in company, and this function
 * stays unopinionated about where it came from.
 *
 * Never throws. A report that could not be announced is still a report; failing
 * a completed run over its notification would be the wrong trade.
 *
 * @param {object} options
 * @param {string} options.baseUrl    e.g. https://mattermost.example.com
 * @param {string} options.token      bot account token
 * @param {string} options.channelId
 * @param {string} options.message    markdown
 * @param {string} [options.filePath] attached when present and readable
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function postMattermostFile({ baseUrl, token, channelId, message, filePath = null, logger = console }) {
  const axios = require("axios");
  const fs = require("fs");
  const path = require("path");

  if (!baseUrl || !token || !channelId) {
    logger.warn?.("\u26a0\ufe0f Mattermost not configured (baseUrl / token / channelId) \u2014 skipping the post.");

    return { ok: false, error: "not configured" };
  }

  const base = String(baseUrl).replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${token}` };

  try {
    let fileIds = [];

    if (filePath && fs.existsSync(filePath)) {
      const FormData = require("form-data");
      const form = new FormData();

      form.append("channel_id", channelId);
      form.append("files", fs.createReadStream(filePath), path.basename(filePath));

      const uploaded = await axios.post(`${base}/api/v4/files`, form, {
        headers: { ...auth, ...form.getHeaders() },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60000,
      });

      fileIds = (uploaded.data.file_infos || []).map((info) => info.id);
    }

    await axios.post(
      `${base}/api/v4/posts`,
      { channel_id: channelId, message, file_ids: fileIds },
      { headers: { ...auth, "Content-Type": "application/json" }, timeout: 30000 }
    );

    logger.info?.(`\u2705 Posted to Mattermost${fileIds.length ? " (with file)" : " (summary only)"}.`);

    return { ok: true };
  } catch (error) {
    const detail = error.response
      ? `${error.response.status} ${JSON.stringify(error.response.data)}`
      : error.message;

    logger.error?.(`\ud83d\udea8 Failed to post to Mattermost: ${detail}`);

    return { ok: false, error: detail };
  }
}

module.exports = { sendMattermostNotification, formatSummaryTable, postMattermostFile };

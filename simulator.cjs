require("dotenv").config();
const { createClient } = require("redis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const CHANNEL = process.env.REDIS_CHANNEL;

const PERIOD_MS = Number(process.env.PERIOD_MS || 100);
const DEVICE_COUNT = Number(process.env.DEVICE_COUNT || 5);
const SENSOR_CODE_MAX = Number(process.env.SENSOR_CODE_MAX || 101);

if (!CHANNEL) {
  console.error("❌ REDIS_CHANNEL is required");
  process.exit(1);
}

// sensorCodeId 1~101
function buildValue() {
  const value = {};
  for (let sensorCodeId = 1; sensorCodeId <= SENSOR_CODE_MAX; sensorCodeId++) {
    value[sensorCodeId] = Math.floor(Math.random() * 50000); // 0~49999 랜덤
  }
  return value;
}

function buildPayload(deviceId) {
  const ts = Date.now();
  return {
    companyId: 1,
    deviceId,
    equipmentId: deviceId,
    ts, // publish timestamp
    msgId: `${deviceId}-${ts}`, // 🔥 추적용
    value: buildValue(),
  };
}

async function main() {
  const client = createClient({ url: REDIS_URL });
  client.on("error", (e) => console.error("[SIM] Redis error:", e));
  await client.connect();

  console.log("[SIM] start", {
    CHANNEL,
    PERIOD_MS,
    DEVICE_COUNT,
    SENSOR_CODE_MAX,
    perSecondMessages: (DEVICE_COUNT * 1000) / PERIOD_MS,
  });

  setInterval(async () => {
    try {
      for (let deviceId = 1; deviceId <= DEVICE_COUNT; deviceId++) {
        const payload = buildPayload(deviceId);
        await client.publish(CHANNEL, JSON.stringify(payload));
      }
    } catch (e) {
      console.error("[SIM] publish error:", e);
    }
  }, PERIOD_MS);
}

main();

require("dotenv").config();
const { io } = require("socket.io-client");

const SERVER_URL = process.env.SERVER_URL || "http://localhost:5005";
const SUBSCRIBE_EVENT = process.env.SUBSCRIBE_EVENT || "widget:subscribe";

// 몇 명을 만들지 / 얼마나 천천히 늘릴지
const CLIENTS = Number(process.env.CLIENTS || 50); // 총 클라 수
const RAMP_PER_SEC = Number(process.env.RAMP_PER_SEC || 10); // 초당 몇 명씩 접속
const RUN_SEC = Number(process.env.RUN_SEC || 60); // 총 실행 시간(초)
const PING_INTERVAL_MS = Number(process.env.PING_INTERVAL_MS || 25000);

let SUBSCRIBE_SETS;
try {
  SUBSCRIBE_SETS = JSON.parse(process.env.SUBSCRIBE_SETS_JSON || "[]");
} catch (e) {
  console.error("❌ SUBSCRIBE_SETS_JSON JSON parse error:", e);
  process.exit(1);
}
if (!Array.isArray(SUBSCRIBE_SETS) || SUBSCRIBE_SETS.length === 0) {
  SUBSCRIBE_SETS = [[1, 2, 5]];
}

// ---- metrics ----
let connected = 0;
let connectFail = 0;
let eventsTotal = 0;
let eventsPerSec = 0;

let latencyCount = 0;
let latencySum = 0;
let latencyMax = 0;
let tsMiss = 0;

let sampleLogged = 0;

const sockets = [];

function pickSubscription(i) {
  return SUBSCRIBE_SETS[i % SUBSCRIBE_SETS.length];
}

function extractTs(payload) {
  if (!payload || typeof payload !== "object") return undefined;

  // 가장 흔한 후보들을 우선 체크
  const direct = payload.ts;
  if (typeof direct === "number") return direct;

  const candidates = [
    payload.data?.ts,
    payload.payload?.ts,
    payload.value?.ts,
    payload.meta?.ts,
    payload.result?.ts,
  ];

  for (const c of candidates) {
    if (typeof c === "number") return c;
  }

  return undefined;
}

function recordLatency(payload) {
  const ts = extractTs(payload);
  if (typeof ts !== "number") {
    tsMiss += 1;
    return;
  }

  const lag = Date.now() - ts;
  latencyCount += 1;
  latencySum += lag;
  if (lag > latencyMax) latencyMax = lag;
}

function connectOne(i) {
  const sub = pickSubscription(i);

  const COOKIE = process.env.COOKIE || "";

  const socket = io(SERVER_URL, {
    extraHeaders: COOKIE ? { Cookie: COOKIE } : {},
    // transports는 일단 기본(삭제한 상태) 추천
    timeout: 5000,
    reconnection: true,
    reconnectionAttempts: 3,
  });

  socket.on("connect", () => {
    connected += 1;
    console.log("[subscribing]", socket.id, sub);

    // sub는 예: [1,2,4]
    socket.emit(SUBSCRIBE_EVENT, sub, (ack) => {
      if (ack !== undefined) console.log("[subscribe ack]", sub, ack);
    });
  });

  socket.on("connect_error", (err) => {
    connectFail += 1;
    console.log(
      "[connect_error]",
      err?.message,
      err?.description || "",
      err?.context || ""
    );
  });

  // ✅ 이벤트명이 여러 개인 문제 해결: 전부 수신
  socket.onAny((eventName, payload) => {
    eventsTotal += 1;
    eventsPerSec += 1;

    // if (sampleLogged < 2) {
    //   sampleLogged += 1;
    //   console.log("[sample event]", eventName);
    //   try {
    //     console.log(
    //       "[sample payload keys]",
    //       payload && typeof payload === "object"
    //         ? Object.keys(payload)
    //         : typeof payload
    //     );
    //   } catch {}
    // }

    recordLatency(payload);
  });

  // 연결 유지(서버 설정에 따라 idle disconnect 방지용)
  if (PING_INTERVAL_MS > 0) {
    const t = setInterval(() => {
      if (socket.connected) socket.emit("ping", { t: Date.now() });
    }, PING_INTERVAL_MS);
    socket.on("disconnect", () => clearInterval(t));
  }

  sockets.push(socket);
}

async function main() {
  console.log("[LOAD] start", {
    SERVER_URL,
    SUBSCRIBE_EVENT,
    CLIENTS,
    RAMP_PER_SEC,
    RUN_SEC,
    subscriptions: SUBSCRIBE_SETS.length,
  });

  // 1초마다 요약 출력
  const reportTimer = setInterval(() => {
    const avgLag = latencyCount ? Math.round(latencySum / latencyCount) : null;
    console.log(
      `[LOAD] conn=${connected}/${CLIENTS} fail=${connectFail} ev/s=${eventsPerSec}` +
        (avgLag !== null ? ` lag(avg/max)=${avgLag}/${latencyMax}ms` : "")
    );
    eventsPerSec = 0;
  }, 1000);

  // RAMP: 초당 RAMP_PER_SEC 명씩 접속
  let created = 0;
  const rampTimer = setInterval(() => {
    for (let k = 0; k < RAMP_PER_SEC && created < CLIENTS; k++) {
      connectOne(created);
      created += 1;
    }
    if (created >= CLIENTS) clearInterval(rampTimer);
  }, 1000);

  // RUN_SEC 후 종료
  setTimeout(() => {
    clearInterval(reportTimer);

    const avgLag = latencyCount ? Math.round(latencySum / latencyCount) : null;

    console.log("\n[LOAD] DONE");
    console.log({
      connected,
      connectFail,
      eventsTotal,
      latencyCount,
      avgLagMs: avgLag,
      maxLagMs: latencyMax,
    });

    // 정리
    for (const s of sockets) s.close();
    process.exit(0);
  }, RUN_SEC * 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

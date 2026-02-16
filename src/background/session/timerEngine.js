// background/session/timerEngine.js — Stateless timer helpers

export function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function ensureTimerFields(session) {
    if (!session) return session;
    if (!Number.isFinite(session.elapsedSeconds)) {
        if (session.endTime && session.startTime) {
            session.elapsedSeconds = Math.max(0, session.endTime - session.startTime);
        } else {
            session.elapsedSeconds = 0;
        }
    }
    if (typeof session.isPaused !== "boolean") {
        session.isPaused = false;
    }
    if (typeof session.pausedAt !== "number") {
        session.pausedAt = null;
    }
    return session;
}

export function startTimer(session, now = nowSeconds()) {
    if (!session) return session;
    ensureTimerFields(session);
    if (session.endTime) {
        session.endTime = null;
    }
    if (!session.startTime) {
        session.startTime = now;
    }
    session.isPaused = false;
    session.pausedAt = null;
    return session;
}

export function pauseTimer(session, now = nowSeconds()) {
    if (!session) return session;
    ensureTimerFields(session);
    if (!session.startTime || session.endTime) return session;
    session.elapsedSeconds += Math.max(0, now - session.startTime);
    session.startTime = null;
    session.isPaused = true;
    session.pausedAt = now;
    return session;
}

export function resumeTimer(session, now = nowSeconds()) {
    if (!session) return session;
    ensureTimerFields(session);
    if (session.endTime) {
        session.endTime = null;
    }
    if (!session.startTime) {
        session.startTime = now;
    }
    session.isPaused = false;
    session.pausedAt = null;
    return session;
}

export function stopTimer(session, now = nowSeconds()) {
    if (!session) return session;
    ensureTimerFields(session);
    if (session.endTime) return session;
    if (session.startTime) {
        session.elapsedSeconds += Math.max(0, now - session.startTime);
    }
    session.endTime = now;
    session.isPaused = false;
    session.pausedAt = null;
    return session;
}

export function resetTimer(session) {
    if (!session) return session;
    ensureTimerFields(session);
    session.startTime = null;
    session.endTime = null;
    session.elapsedSeconds = 0;
    session.isPaused = false;
    session.pausedAt = null;
    return session;
}

export function getElapsedSeconds(session, now = nowSeconds()) {
    if (!session) return 0;
    ensureTimerFields(session);
    const base = Number.isFinite(session.elapsedSeconds)
        ? session.elapsedSeconds
        : 0;
    if (session.startTime && !session.endTime && !session.isPaused) {
        return base + Math.max(0, now - session.startTime);
    }
    return Math.max(0, base);
}

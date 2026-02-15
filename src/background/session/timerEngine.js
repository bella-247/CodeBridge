// background/session/timerEngine.js — Stateless timer helpers

export function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

export function startTimer(session, now = nowSeconds()) {
    if (!session || session.startTime) return session;
    session.startTime = now;
    return session;
}

export function stopTimer(session, now = nowSeconds()) {
    if (!session) return session;
    if (!session.endTime) {
        session.endTime = now;
    }
    return session;
}

export function getElapsedSeconds(session, now = nowSeconds()) {
    if (!session || !session.startTime) return 0;
    const end = session.endTime || now;
    return Math.max(0, end - session.startTime);
}

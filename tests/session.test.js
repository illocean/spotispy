"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/pwt/session.js");

const T0 = new Date(2026, 10, 10, 9, 0, 0).getTime();
const MIN = 60000;

function sample(over) {
  return Object.assign({ userId: "u1", trackUri: "spotify:track:a", contextUri: "spotify:playlist:p", ts: T0, isPlaying: true, durationMs: 210000 }, over);
}

test("contiguous plays build one session", () => {
  const s = S.state();
  const a = S.apply(s, sample({ ts: T0 }));
  const b = S.apply(s, sample({ ts: T0 + 3 * MIN, trackUri: "spotify:track:b" }));
  const c = S.apply(s, sample({ ts: T0 + 6 * MIN, trackUri: "spotify:track:c" }));
  assert.equal(a.start.startedAt, T0);
  assert.equal(a.plays.length, 1);
  assert.equal(b.plays[0].trackUri, "spotify:track:b");
  assert.equal(c.plays[0].trackUri, "spotify:track:c");
  assert.equal(s.session.trackCount, 3);
  assert.equal(s.session.id, "u1:" + T0);
  assert.equal(a.plays[0].loopIndex, 1);
});

test("a gap longer than the inactivity window closes the session then opens a new one", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0 }));
  const gap = S.apply(s, sample({ ts: T0 + 10 * MIN, trackUri: "spotify:track:z" }));
  assert.ok(gap.end, "expected the old session to close");
  assert.equal(gap.end.trackCount, 1);
  assert.equal(gap.end.startedAt, T0);
  assert.equal(gap.end.endedAt, T0);
  assert.equal(gap.end.unclean, false);
  assert.notEqual(gap.start.startedAt, T0);
});

test("the same track re-announced within the jitter window is not a second play", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0 }));
  const again = S.apply(s, sample({ ts: T0 + 3000 }));
  assert.equal(again.plays.length, 0);
  assert.equal(s.session.trackCount, 1);
});

test("the same track after a pause resumes as a new play", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0, isPlaying: true }));
  S.apply(s, sample({ ts: T0 + 30000, isPlaying: false }));
  const resumed = S.apply(s, sample({ ts: T0 + 60000, isPlaying: true }));
  assert.equal(resumed.plays.length, 1);
  // paused tick + resumed play both land in the session's track list
  assert.equal(s.session.trackCount, 3);
  assert.equal(resumed.plays[0].loopIndex, 1, "a resume is not a loop iteration");
});

test("loop x3 sets the looped flag on the session and the play", () => {
  const s = S.state();
  // Three consecutive plays of one track, each longer than the re-announcement
  // window, so each is a genuine play rather than the feed repeating one.
  let last;
  for (let i = 0; i < 3; i++) {
    last = S.apply(s, sample({ ts: T0 + i * 10 * 1000, durationMs: 9000 }));
  }
  assert.equal(s.session.looped, true);
  assert.equal(last.plays[0].loopIndex, 3);
  // A new track later in the run restarts the loop counter.
  const next = S.apply(s, sample({ ts: T0 + 40 * 1000, trackUri: "spotify:track:b", durationMs: 9000 }));
  assert.equal(next.plays[0].loopIndex, 1);
  // The feed re-announcing the same play fills the loop counter instead.
  const r = S.state();
  S.apply(r, sample({ ts: T0 }));
  S.apply(r, sample({ ts: T0 + 3000 }));
  const looped = S.apply(r, sample({ ts: T0 + 6000 }));
  assert.equal(looped.looped, true);
});

test("re-announcements of one play count towards the loop", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0 }));
  S.apply(s, sample({ ts: T0 + 3000 }));
  const third = S.apply(s, sample({ ts: T0 + 6000 }));
  assert.ok(third.looped);
  assert.equal(s.session.trackCount, 1);
});

test("a resume followed by a re-announcement does not count the same play twice", () => {
  // Regression: the resume sample satisfies both `newPlay` and `reannounce`, so
  // the run was incremented twice for one play and the loop fired early.
  const s = S.state();
  S.apply(s, sample({ ts: T0, isPlaying: true })); // play 1
  S.apply(s, sample({ ts: T0 + 3000, isPlaying: false })); // pause
  const resumed = S.apply(s, sample({ ts: T0 + 6000, isPlaying: true })); // play 2
  assert.equal(resumed.plays.length, 1, "the resume is one play");
  assert.equal(resumed.plays[0].loopIndex, 1, "and the first of its own run");
  const re = S.apply(s, sample({ ts: T0 + 9000, isPlaying: true })); // re-announcement
  assert.equal(re.looped, undefined, "two real plays are not a loop");
  assert.equal(s.session.looped, false, "the session is not marked as looping");
  assert.equal(s.session.trackCount, 2, "two plays, not three");
});

test("a track abandoned before half its duration marks the session skipped", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0, durationMs: 240000 }));
  const next = S.apply(s, sample({ ts: T0 + 60000, trackUri: "spotify:track:b" }));
  assert.ok(next.priorSkipped);
  assert.equal(s.session.skipped, true);
});

test("a track played past half its duration is not a skip", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0, durationMs: 240000 }));
  const next = S.apply(s, sample({ ts: T0 + 200000, trackUri: "spotify:track:b" }));
  assert.equal(next.priorSkipped, undefined);
  assert.equal(s.session.skipped, false);
});

test("disappearing twice reports a hidden window, appearing again reports online", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0 }));
  assert.equal(S.missed(s, { userId: "u1", ts: T0 + MIN }), null);
  const hidden = S.missed(s, { userId: "u1", ts: T0 + 2 * MIN });
  assert.ok(hidden);
  const back = S.apply(s, sample({ ts: T0 + 3 * MIN, trackUri: "spotify:track:q" }));
  assert.ok(back.online);
  assert.equal(back.online.first, false);
  assert.equal(s.missed, 0);
});

test("first sighting is online(first) and needs no play to open presence", () => {
  const s = S.state();
  const a = S.apply(s, sample({ ts: T0 }));
  assert.equal(a.online.first, true);
});

test("unclean shutdown closes a session at its last observed play", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0 }));
  S.apply(s, sample({ ts: T0 + 2 * MIN, trackUri: "spotify:track:b" }));
  const closed = S.closeAll({ u1: s }, T0 + 60 * MIN);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].unclean, true);
  assert.equal(closed[0].endedAt, T0 + 2 * MIN, "must not stretch to now");
  assert.equal(s.session, null);
});

test("snapshot/restore round-trips and keeps the session open", () => {
  const s = S.state();
  S.apply(s, sample({ ts: T0 }));
  const saved = S.snapshot(s);
  const back = S.restore(JSON.parse(JSON.stringify(saved)));
  const next = S.apply(back, sample({ ts: T0 + 30000, trackUri: "spotify:track:b" }));
  assert.equal(next.start, null, "the restored session is still open");
  assert.equal(next.end, null);
  assert.equal(back.session.trackCount, 2);
  // A finished snapshot never resurrects a session, even with a stale marker.
  const closed = S.restore(JSON.parse(JSON.stringify({ session: null, lastTrackUri: "x", playing: true })));
  assert.equal(closed.session, null);
});

test("presenceWindows merges ticks and splits on a hidden flag", () => {
  const w = S.presenceWindows(
    [
      { ts: T0, hidden: false },
      { ts: T0 + MIN, hidden: false },
      { ts: T0 + 2 * MIN, hidden: true },
      { ts: T0 + 3 * MIN, hidden: false },
    ],
    { INACTIVITY_MS: 5 * MIN }
  );
  assert.equal(w.length, 3);
  assert.equal(w[0].from, T0);
  assert.equal(w[1].hidden, true);
});

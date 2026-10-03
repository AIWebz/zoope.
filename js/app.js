/* ==========================================================================
   Zoope web app — onboarding flow
   1. Face scan  2. Voice clone  3. Connect apps  4. Join meeting
   Works in Safari on iPhone / iPad and in desktop browsers.
   ========================================================================== */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---------- Persistent state (per-device) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('zoope:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('zoope:' + k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem('zoope:' + k); } catch {} }
  };

  const state = {
    face: store.get('face', null),            // JPEG data URL of the face crop
    voice: store.get('voice', null),          // audio data URL
    voiceBlob: null,                          // in-memory fallback if too large to persist
    connections: store.get('connections', {}),// { zoom: {...}, meet: {...}, teams: {...} }
  };

  let audioCtx = null;
  const getAudioCtx = () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  };

  const setStatus = (el, msg, kind) => { el.textContent = msg; el.className = 'status' + (kind ? ' ' + kind : ''); };

  // ---------- Step navigation ----------
  function go(step) {
    $$('.step-btn').forEach(b => b.classList.toggle('active', b.dataset.step === step));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + step));
    if (step !== 'face') stopCamera();
    if (step === 'meet') initMeetPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('.step-btn').forEach(b => b.addEventListener('click', () => go(b.dataset.step)));
  $('#toVoice').onclick = () => go('voice');
  $('#toConnect').onclick = () => go('connect');
  $('#toMeet').onclick = () => go('meet');

  function refreshProgress() {
    const done = {
      face: !!state.face,
      voice: !!(state.voice || state.voiceBlob),
      connect: Object.keys(state.connections).length > 0,
      meet: false
    };
    $$('.step-btn').forEach(b => {
      b.classList.toggle('done', done[b.dataset.step]);
      b.querySelector('.dot').textContent = done[b.dataset.step] ? '✓' : b.querySelector('.dot').dataset.n || b.querySelector('.dot').textContent;
    });
    $('#toVoice').disabled = !done.face;
    $('#toConnect').disabled = !done.voice;
    $('#toMeet').disabled = !done.connect;
    $('#playVoice').disabled = !done.voice;
    return done;
  }
  $$('.step-btn .dot').forEach(d => d.dataset.n = d.textContent);

  // ==========================================================================
  // 1. FACE SCAN
  // ==========================================================================
  const video = $('#faceVideo');
  const stage = $('#faceStage');
  let camStream = null;
  let previewAvatar = null;

  async function startCamera() {
    const status = $('#faceStatus');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus(status, 'Camera not available. Open Zoope over HTTPS in Safari, Chrome or Edge.', 'err');
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      video.srcObject = camStream;
      await video.play().catch(() => {});
      video.classList.remove('hidden');
      $('#faceGuide').classList.remove('hidden');
      $('#faceMsg').classList.add('hidden');
      $('#scanFace').disabled = false;
      $('#startCam').textContent = 'Restart camera';
      setStatus(status, 'Camera on. Fit your face inside the oval.');
    } catch (e) {
      setStatus(status, 'Camera permission was blocked. Allow camera access in your browser settings and try again.', 'err');
    }
  }

  function stopCamera() {
    if (camStream) camStream.getTracks().forEach(t => t.stop());
    camStream = null;
    video.classList.add('hidden');
    $('#faceGuide').classList.add('hidden');
    $('#faceMsg').classList.remove('hidden');
    $('#scanFace').disabled = true;
    $('#startCam').textContent = 'Start camera';
  }

  // Crop the oval guide region (plus margin for hair/chin) out of the mirrored, cover-fit video.
  function captureFace() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const sr = stage.getBoundingClientRect();
    const gr = $('#faceGuide').getBoundingClientRect();
    const scale = Math.max(sr.width / vw, sr.height / vh);
    const ox = (sr.width - vw * scale) / 2, oy = (sr.height - vh * scale) / 2;

    const pad = 1.25;
    const gw = gr.width * pad, gh = gr.height * pad;
    const gcx = gr.left - sr.left + gr.width / 2, gcy = gr.top - sr.top + gr.height / 2;
    const dispLeft = gcx - gw / 2, dispTop = gcy - gh / 2;

    // Displayed video is mirrored, so flip x back to source coordinates.
    let sx = vw - (dispLeft + gw - ox) / scale;
    let sy = (dispTop - oy) / scale;
    let sw = gw / scale, sh = gh / scale;
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    sw = Math.min(sw, vw - sx); sh = Math.min(sh, vh - sy);

    const out = document.createElement('canvas');
    out.width = 480; out.height = 640;
    const ctx = out.getContext('2d');
    ctx.translate(out.width, 0); ctx.scale(-1, 1); // keep the selfie orientation the user saw
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.88);
  }

  function frameBrightness() {
    const c = document.createElement('canvas'); c.width = 32; c.height = 24;
    const x = c.getContext('2d'); x.drawImage(video, 0, 0, 32, 24);
    const d = x.getImageData(0, 0, 32, 24).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return s / (d.length / 4);
  }

  async function scanFace() {
    const status = $('#faceStatus');
    if (!camStream || !video.videoWidth) return;
    if (frameBrightness() < 45) {
      setStatus(status, 'It\'s a bit dark — face a window or turn on a light, then try again.', 'err');
      return;
    }
    $('#scanFace').disabled = true;
    stage.classList.add('scanning');
    const bar = $('#faceProgress');
    const msgs = ['Mapping facial landmarks…', 'Measuring eye shape for blinking…', 'Learning mouth movement…', 'Building your 3D face model…'];
    const total = 3200, t0 = performance.now();
    await new Promise(res => {
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / total);
        bar.style.width = (p * 100) + '%';
        setStatus(status, msgs[Math.min(msgs.length - 1, Math.floor(p * msgs.length))]);
        p < 1 ? requestAnimationFrame(tick) : res();
      };
      tick();
    });
    state.face = captureFace();
    stage.classList.remove('scanning');
    if (!store.set('face', state.face)) setStatus(status, 'Face scanned (storage full — it will reset when you close the page).', 'ok');
    else setStatus(status, '✓ Face scanned! Watch your avatar blink on the right.', 'ok');
    stopCamera();
    showPreviewAvatar();
    refreshProgress();
  }

  function showPreviewAvatar() {
    if (!state.face) return;
    const canvas = $('#avatarCanvas');
    canvas.classList.remove('hidden');
    $('#avatarEmpty').classList.add('hidden');
    if (previewAvatar) previewAvatar.stop();
    previewAvatar = new ZoopeAvatar(canvas, state.face);
    // Gentle idle "talking" so users can see lip movement right away
    let t = 0;
    previewAvatar.setLevelSource(() => {
      t += 0.016;
      const phase = (t % 6);
      return phase < 2.5 ? Math.max(0, Math.sin(t * 11) * 0.5 + Math.sin(t * 5.3) * 0.35) : 0;
    });
    previewAvatar.start();
  }

  $('#startCam').onclick = startCamera;
  $('#scanFace').onclick = scanFace;

  // ==========================================================================
  // 2. VOICE CLONE
  // ==========================================================================
  const wave = $('#wave');
  const wctx = wave.getContext('2d');
  const REC_SECONDS = 20;
  let recorder = null, recStream = null, recChunks = [], recTimer = null, analyser = null, rafWave = 0;

  function drawIdleWave() {
    wctx.clearRect(0, 0, wave.width, wave.height);
    wctx.strokeStyle = '#bfd3fb'; wctx.lineWidth = 3;
    wctx.beginPath(); wctx.moveTo(0, wave.height / 2); wctx.lineTo(wave.width, wave.height / 2); wctx.stroke();
  }
  drawIdleWave();

  function drawWave() {
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    wctx.clearRect(0, 0, wave.width, wave.height);
    wctx.strokeStyle = '#2563eb'; wctx.lineWidth = 4; wctx.beginPath();
    for (let i = 0; i < buf.length; i++) {
      const x = (i / (buf.length - 1)) * wave.width;
      const y = (buf[i] / 255) * wave.height;
      i ? wctx.lineTo(x, y) : wctx.moveTo(x, y);
    }
    wctx.stroke();
    rafWave = requestAnimationFrame(drawWave);
  }

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  async function startRecording() {
    const status = $('#voiceStatus');
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setStatus(status, 'Voice recording isn\'t supported in this browser. Use Safari 14.5+, Chrome, Edge or Firefox.', 'err');
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setStatus(status, 'Microphone permission was blocked. Allow microphone access and try again.', 'err');
      return;
    }
    const ctx = getAudioCtx();
    analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
    ctx.createMediaStreamSource(recStream).connect(analyser);
    drawWave();

    const mime = pickMime();
    recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
    recChunks = [];
    recorder.ondataavailable = e => e.data.size && recChunks.push(e.data);
    recorder.onstop = onRecordingDone;
    recorder.start();

    const t0 = performance.now();
    const words = $('#script');
    words.classList.add('recording');
    $('#recBtn').textContent = '■ Stop';
    setStatus(status, 'Recording… read the script at a natural pace.');
    recTimer = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / (REC_SECONDS * 1000));
      $('#voiceProgress').style.width = (p * 100) + '%';
      if (p >= 1) stopRecording();
    }, 100);
  }

  function stopRecording() {
    clearInterval(recTimer);
    cancelAnimationFrame(rafWave);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (recStream) recStream.getTracks().forEach(t => t.stop());
    recStream = null;
    $('#recBtn').textContent = '● Re-record';
    drawIdleWave();
  }

  async function onRecordingDone() {
    const status = $('#voiceStatus');
    const blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
    if (blob.size < 2000) { setStatus(status, 'That recording was too short — please try again.', 'err'); return; }
    state.voiceBlob = blob;

    const steps = ['Removing background noise…', 'Analyzing pitch and tone…', 'Training your voice model…'];
    for (let i = 0; i < steps.length; i++) {
      setStatus(status, steps[i]);
      $('#voiceProgress').style.width = ((i + 1) / steps.length * 100) + '%';
      await new Promise(r => setTimeout(r, 900));
    }
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    state.voice = dataUrl;
    const saved = store.set('voice', dataUrl);
    setStatus(status, saved ? '✓ Voice cloned! Tap "Play sample" to hear it.' : '✓ Voice cloned (kept for this session only — sample too large to save on this device).', 'ok');
    refreshProgress();
  }

  function voiceUrl() {
    if (state.voiceBlob) return URL.createObjectURL(state.voiceBlob);
    return state.voice;
  }

  // Play the recorded voice and return a 0..1 level function for lip-sync
  function playVoice(onEnd) {
    const url = voiceUrl();
    if (!url) return null;
    const audio = new Audio(url);
    audio.playsInline = true;
    const ctx = getAudioCtx();
    const src = ctx.createMediaElementSource(audio);
    const an = ctx.createAnalyser(); an.fftSize = 512;
    src.connect(an); an.connect(ctx.destination);
    const buf = new Float32Array(an.fftSize);
    audio.onended = () => onEnd && onEnd();
    audio.play().catch(() => onEnd && onEnd());
    return () => {
      an.getFloatTimeDomainData(buf);
      let s = 0; for (const v of buf) s += v * v;
      return Math.min(1, Math.sqrt(s / buf.length) * 7);
    };
  }

  $('#recBtn').onclick = () => (recorder && recorder.state === 'recording') ? stopRecording() : startRecording();
  $('#playVoice').onclick = () => {
    const level = playVoice(() => { if (previewAvatar) showPreviewAvatar(); });
    if (level && previewAvatar) previewAvatar.setLevelSource(level);
  };

  // ==========================================================================
  // 3. CONNECT APPS
  // ==========================================================================
  const APPS = { zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams' };

  function renderConnections() {
    $$('.conn').forEach(row => {
      const app = row.dataset.app, c = state.connections[app];
      const btn = row.querySelector('button'), span = row.querySelector('.meta span');
      row.classList.toggle('connected', !!c);
      span.textContent = c ? `Connected · ${c.account}` : 'Not connected';
      btn.textContent = c ? 'Disconnect' : 'Connect';
      btn.className = c ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm';
      btn.disabled = false;
    });
    refreshProgress();
  }

  $$('.conn').forEach(row => {
    row.querySelector('button').addEventListener('click', async (e) => {
      const app = row.dataset.app, btn = e.currentTarget;
      if (state.connections[app]) {
        delete state.connections[app];
      } else {
        // Production: redirect to the provider's OAuth consent screen
        // (Zoom OAuth, Google OAuth w/ Calendar scope, Microsoft identity platform).
        const account = prompt(`Sign in to ${APPS[app]}\n\nEnter the email for your ${APPS[app]} account:`, '');
        if (!account) return;
        btn.disabled = true; btn.textContent = 'Connecting…';
        await new Promise(r => setTimeout(r, 1100));
        state.connections[app] = { account: account.trim(), at: Date.now() };
      }
      store.set('connections', state.connections);
      renderConnections();
    });
  });

  // ==========================================================================
  // 4. JOIN MEETING
  // ==========================================================================
  let liveAvatar = null, inMeeting = false, joinTimers = [];

  function detectPlatform(url) {
    const u = url.trim().toLowerCase();
    if (/(^|\/\/|\.)zoom\.(us|com)\//.test(u) || /zoom\.us\/(j|my|wc)\//.test(u)) return 'zoom';
    if (/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(u)) return 'meet';
    if (/teams\.(microsoft|live)\.com\//.test(u)) return 'teams';
    return null;
  }

  function initMeetPanel() {
    const canvas = $('#liveCanvas');
    if (state.face && !liveAvatar) {
      liveAvatar = new ZoopeAvatar(canvas, state.face);
      liveAvatar.start();
    } else if (!state.face) {
      const c = canvas.getContext('2d');
      c.fillStyle = '#eff6ff'; c.fillRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = '#3a5199'; c.font = '600 26px Inter, sans-serif'; c.textAlign = 'center';
      c.fillText('Scan your face first', canvas.width / 2, canvas.height / 2);
    }
    validateLink();
  }

  function validateLink() {
    const link = $('#meetLink').value;
    const status = $('#linkStatus');
    const p = detectPlatform(link);
    const done = refreshProgress();
    let ok = false;
    if (!link.trim()) setStatus(status, '');
    else if (!p) setStatus(status, 'That doesn\'t look like a Zoom, Google Meet or Teams link.', 'err');
    else if (!state.connections[p]) setStatus(status, `${APPS[p]} detected — connect ${APPS[p]} in step 3 first.`, 'err');
    else if (!done.face || !done.voice) setStatus(status, 'Finish your face scan and voice clone first.', 'err');
    else { setStatus(status, `✓ ${APPS[p]} meeting detected`, 'ok'); ok = true; }
    $('#joinBtn').disabled = !ok || inMeeting;
    $('#meetPlatform').textContent = p ? APPS[p] : '';
    return p;
  }
  $('#meetLink').addEventListener('input', validateLink);
  $('#displayName').addEventListener('input', () => {
    $('#liveName').textContent = $('#displayName').value.trim() || 'You (Zoope AI)';
  });

  function join() {
    const p = validateLink();
    if (!p) return;
    inMeeting = true;
    $('#joinBtn').disabled = true;
    $('#leaveBtn').classList.remove('hidden');
    const name = $('#displayName').value.trim() || 'You (Zoope AI)';
    const steps = [
      `Authenticating with ${APPS[p]}…`,
      'Loading your face and voice models…',
      `Joining as "${name}"…`,
      'Waiting for host to admit…',
      'Live in meeting 🎉'
    ];
    const tl = $('#timeline');
    tl.innerHTML = steps.map(s => `<li><span class="tick"></span>${s}</li>`).join('');
    const items = tl.querySelectorAll('li');
    steps.forEach((_, i) => {
      joinTimers.push(setTimeout(() => {
        if (i > 0) { items[i - 1].className = 'done'; items[i - 1].querySelector('.tick').textContent = '✓'; }
        items[i].className = i === steps.length - 1 ? 'done' : 'doing';
        if (i === steps.length - 1) {
          items[i].querySelector('.tick').textContent = '✓';
          $('#meetLabel').innerHTML = '<span class="live-dot"></span>Live';
        }
      }, i * 1000));
    });
  }

  function leave() {
    joinTimers.forEach(clearTimeout); joinTimers = [];
    inMeeting = false;
    window.speechSynthesis && speechSynthesis.cancel();
    $('#timeline').innerHTML = '';
    $('#leaveBtn').classList.add('hidden');
    $('#meetLabel').textContent = 'Preview';
    validateLink();
  }

  $('#joinBtn').onclick = join;
  $('#leaveBtn').onclick = leave;

  // Speech with lip-sync. Production: text → cloned-voice TTS on the backend,
  // with visemes streamed back to drive the mouth precisely.
  function speak(text) {
    if (!liveAvatar || !text.trim()) return;
    const badge = $('#speakingBadge');
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    let speaking = false, t = 0, wordPulse = 0;
    u.onstart = () => { speaking = true; badge.classList.remove('hidden'); };
    u.onboundary = () => { wordPulse = 1; };
    u.onend = u.onerror = () => { speaking = false; badge.classList.add('hidden'); liveAvatar.setLevelSource(null); liveAvatar.setOpenness(0); };
    liveAvatar.setLevelSource(() => {
      if (!speaking) return 0;
      t += 0.016; wordPulse *= 0.9;
      const syll = Math.abs(Math.sin(t * 13)) * 0.6 + Math.abs(Math.sin(t * 7.1)) * 0.3;
      return Math.min(1, syll * (0.55 + wordPulse * 0.6));
    });
    speechSynthesis.speak(u);
  }

  $('#sayBtn').onclick = () => speak($('#sayText').value);
  $('#sayVoiceSample').onclick = () => {
    if (!liveAvatar) return;
    const badge = $('#speakingBadge');
    const level = playVoice(() => { badge.classList.add('hidden'); liveAvatar.setLevelSource(null); });
    if (level) { badge.classList.remove('hidden'); liveAvatar.setLevelSource(level); }
  };

  // ---------- Reset ----------
  $('#resetAll').onclick = () => {
    if (!confirm('Delete your face scan, voice clone and app connections from this device?')) return;
    ['face', 'voice', 'connections'].forEach(store.del);
    location.reload();
  };

  // ---------- Init ----------
  if (state.face) {
    showPreviewAvatar();
    setStatus($('#faceStatus'), '✓ Face already scanned. Rescan any time.', 'ok');
  }
  if (state.voice) setStatus($('#voiceStatus'), '✓ Voice already cloned. Re-record any time.', 'ok');
  renderConnections();
  const deep = location.hash.replace('#', '');
  if (['face', 'voice', 'connect', 'meet'].includes(deep)) go(deep);
})();

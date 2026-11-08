/* Lampu meja interaktif — halaman login (#/akun).
   Lampu adalah SAKLAR Masuk/Daftar: lampu MATI = kartu Masuk,
   lampu MENYALA = kartu Daftar. Tarik tali (drag ke bawah) atau
   ketuk tali / kepala lampu untuk menyalakan atau mematikan lampu
   — sekaligus berpindah kartu. Bunyi dengung mengikuti pola
   Web Audio dari referensi: sine 120 Hz, envelope 0.001 -> 0.06
   -> 0.001 selama ~0.35 detik, hanya saat user menarik/mengetuk.
   Klik langsung tab Masuk/Daftar juga menyinkronkan lampu
   (tanpa bunyi). Tilt parallax halus mengikuti pointer (hanya
   mouse, hanya transform). Animasi murni visual: form tetap bisa dipakai
   walau lampu mati, dan tidak ada state login yang disimpan di
   sini. Sinkron tab HANYA pada aksi user — bukan saat init —
   supaya deep-link sidebar "Daftar"/"Masuk" tidak dilawan. */
(function(){
  var stage = document.getElementById("lampStage");
  var cord = document.getElementById("lampCord");
  var headBtn = document.getElementById("lampHeadBtn");
  var hint = document.getElementById("lampHint");
  var wrap = document.querySelector(".auth-wrap");
  if (!stage || !cord || !wrap) return;

  var on = false;
  var audioCtx = null;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var HINT_OFF = "Tarik tali untuk mendaftar";
  var HINT_ON = "Matikan lampu untuk masuk";

  function applyState(){
    stage.classList.toggle("on", on);
    wrap.classList.toggle("lamp-on", on);
    wrap.classList.toggle("lamp-dim", !on);
    cord.setAttribute("aria-pressed", on ? "true" : "false");
    cord.setAttribute("aria-label", on ? "Matikan lampu dan masuk" : "Nyalakan lampu dan buka pendaftaran");
    if (hint) hint.textContent = on ? HINT_ON : HINT_OFF;
  }

  /* Tilt parallax 3D: rig lampu sedikit miring mengikuti pointer.
     Hanya mouse (pointer:fine), hanya properti transform, mati bila
     prefers-reduced-motion. Sudut kecil (±6°/±4°) supaya tetap kalem. */
  var rig = document.getElementById("lampRig");
  var finePointer = window.matchMedia && window.matchMedia("(pointer:fine)").matches;
  var tiltRaf = null, tiltX = 0, tiltY = 0;
  function applyTilt(){
    tiltRaf = null;
    if (rig) rig.style.transform = "rotateX(" + tiltX.toFixed(2) + "deg) rotateY(" + tiltY.toFixed(2) + "deg)";
  }
  function queueTilt(){ if (tiltRaf === null) tiltRaf = requestAnimationFrame(applyTilt); }
  if (rig && finePointer && !reduceMotion) {
    stage.addEventListener("pointermove", function(ev){
      var r = stage.getBoundingClientRect();
      var nx = (ev.clientX - r.left) / r.width * 2 - 1;
      var ny = (ev.clientY - r.top) / r.height * 2 - 1;
      tiltY = Math.max(-1, Math.min(1, nx)) * 6;
      tiltX = Math.max(-1, Math.min(1, ny)) * -4;
      queueTilt();
    });
    stage.addEventListener("pointerleave", function(){ tiltX = 0; tiltY = 0; queueTilt(); });
  }

  /* Dengung sakelar lampu: oscillator sine 120 Hz, gain naik pelan
     lalu turun — persis pola kode referensi. AudioContext dibuat
     malas, hanya di dalam gesture user, jadi tidak kena blokir
     autoplay. */
  function hum(){
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var now = audioCtx.currentTime;
      var humOsc = audioCtx.createOscillator();
      var humGain = audioCtx.createGain();
      humOsc.type = "sine";
      humOsc.frequency.setValueAtTime(120, now + 0.05);
      humGain.gain.setValueAtTime(0.001, now);
      humGain.gain.linearRampToValueAtTime(0.06, now + 0.08);
      humGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      humOsc.connect(humGain);
      humGain.connect(audioCtx.destination);
      humOsc.start(now + 0.05);
      humOsc.stop(now + 0.38);
    } catch (e) {}
  }

  /* Pindah kartu lewat handler tab yang sudah ada di app.js
     (klik tombol tab — aman dari scope fungsi showAuthTab). */
  function goTab(which){
    var btn = document.getElementById(which === "register" ? "tabRegister" : "tabLogin");
    if (btn) btn.click();
  }

  /* toggle() karena aksi USER (tarik/klik tali, ketuk kepala):
     lampu membalik DAN kartu ikut berpindah — nyala = Daftar,
     mati = Masuk. Dengung hanya di sini (aksi user). */
  function toggle(playSound){
    on = !on;
    applyState();
    if (playSound) hum();
    goTab(on ? "register" : "login");
    if (!reduceMotion) {
      cord.classList.remove("sway");
      void cord.offsetWidth;
      cord.classList.add("sway");
    }
  }

  /* Sinkron dua arah: klik langsung tab Masuk/Daftar (bukan lewat
     tali) ikut menyalakan/mematikan lampu, TANPA bunyi. Guard
     `on !== want` mencegah loop dengan goTab() di toggle(). */
  var tabLogin = document.getElementById("tabLogin");
  var tabRegister = document.getElementById("tabRegister");
  if (tabLogin) tabLogin.addEventListener("click", function(){
    if (on) { on = false; applyState(); }
  });
  if (tabRegister) tabRegister.addEventListener("click", function(){
    if (!on) { on = true; applyState(); }
  });

  /* --- tarik tali: drag vertikal pakai pointer events (jalan di
     sentuhan HP maupun mouse). Tarik >= 24px lalu lepas = toggle.
     Ketukan biasa (tanpa drag) juga toggle lewat event click. --- */
  var line = cord.querySelector(".lamp-cord-line");
  var knob = cord.querySelector(".lamp-cord-knob");
  var startY = null;
  var dy = 0;
  var pulled = false;
  var suppressClick = false;

  function setPull(d){
    if (line) line.style.transform = "scaleY(" + (1 + d / 48) + ")";
    if (knob) knob.style.transform = "translateY(" + d + "px)";
  }
  function clearPull(){
    if (line) line.style.transform = "";
    if (knob) knob.style.transform = "";
  }
  cord.addEventListener("pointerdown", function(ev){
    startY = ev.clientY;
    dy = 0;
    pulled = false;
    try { cord.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  cord.addEventListener("pointermove", function(ev){
    if (startY === null) return;
    dy = Math.max(0, Math.min(44, ev.clientY - startY));
    setPull(dy);
    if (dy >= 24) pulled = true;
  });
  cord.addEventListener("pointerup", function(){
    if (startY === null) return;
    startY = null;
    clearPull();
    if (pulled) {
      toggle(true);
      suppressClick = true;
      setTimeout(function(){ suppressClick = false; }, 60);
    }
  });
  cord.addEventListener("pointercancel", function(){
    startY = null;
    clearPull();
  });
  cord.addEventListener("click", function(){
    if (suppressClick) return;
    toggle(true);
  });

  /* Ketuk kepala lampu (kap) juga toggle. Tombol ini sengaja
     disembunyikan dari pembaca layar (aria-hidden + tabindex -1)
     supaya kontrol aksesibelnya tetap satu: tali lampunya. */
  if (headBtn) {
    headBtn.addEventListener("click", function(){ toggle(true); });
  }

  /* prefers-reduced-motion: lampu langsung menyala tanpa animasi
     goyang — form langsung terang, tanpa gerakan. */
  if (reduceMotion) {
    on = true;
    applyState();
  } else {
    applyState();
  }
})();

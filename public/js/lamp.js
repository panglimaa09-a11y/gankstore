/* Lampu meja interaktif — halaman login (#/akun).
   Lampu adalah SAKLAR dua kartu terpisah: lampu MATI = kartu Masuk,
   lampu MENYALA = kartu Daftar. Tarik tali (drag ke bawah) atau
   ketuk tali / kepala lampu untuk menyalakan atau mematikan lampu
   — sekaligus berpindah kartu. Bunyi dengung mengikuti pola
   Web Audio dari referensi: sine 120 Hz, envelope 0.001 -> 0.06
   -> 0.001 selama ~0.35 detik, hanya saat user menarik/mengetuk.
   Tautan teks di bawah tiap kartu ("Belum punya akun? Daftar" /
   "Sudah punya akun? Masuk") juga mengganti kartu DAN lampu, tanpa
   bunyi — seperti tab dulu. Tilt parallax halus mengikuti pointer
   (hanya mouse, hanya transform). Animasi murni visual: form tetap
   bisa dipakai walau lampu mati, dan tidak ada state login yang
   disimpan di sini. SATU fungsi pusat (setAuthView, diekspos ke
   window) mengatur kartu + lampu — semua jalur ganti, termasuk
   pemrograman dari app.js (sidebar "Daftar", email belum terdaftar),
   lewat fungsi itu, supaya kartu dan lampu tidak pernah tidak
   sinkron. */
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

  /* SATU fungsi pusat ganti kartu + lampu. which: "login" | "register".
     opts.sound=true hanya untuk aksi fisik (tarik/ketuk tali, ketuk
     kepala) — tautan teks dan pemrograman tidak berbunyi. Kartu
     diganti lewat showAuthCard di app.js (dimuat sebelum file ini);
     kalau belum ada, kartu tidak diganti tapi lampu tetap jalan. */
  function setAuthView(which, opts){
    var wantOn = which === "register";
    var sound = !!(opts && opts.sound);
    if (wantOn !== on) {
      on = wantOn;
      applyState();
      if (sound) hum();
      if (sound && !reduceMotion) {
        cord.classList.remove("sway");
        void cord.offsetWidth;
        cord.classList.add("sway");
      }
    }
    if (typeof window.showAuthCard === "function") window.showAuthCard(which);
  }
  window.setAuthView = setAuthView;

  /* toggle() karena aksi USER (tarik/klik tali, ketuk kepala):
     lampu membalik DAN kartu ikut berpindah — nyala = Daftar,
     mati = Masuk. Dengung hanya di sini (aksi fisik). */
  function toggle(playSound){
    setAuthView(on ? "login" : "register", {sound: !!playSound});
  }

  /* Tautan teks di bawah tiap kartu ("Belum punya akun? Daftar" /
     "Sudah punya akun? Masuk") — pengganti tab: ganti kartu DAN
     lampu, TANPA bunyi. */
  var linkToRegister = document.getElementById("linkToRegister");
  var linkToLogin = document.getElementById("linkToLogin");
  if (linkToRegister) linkToRegister.addEventListener("click", function(){ setAuthView("register"); });
  if (linkToLogin) linkToLogin.addEventListener("click", function(){ setAuthView("login"); });

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

  /* Init: deep-link sidebar ("Daftar"/"Masuk") yang diproses app.js
     sebelum file ini termuat menang dulu — lampunya menyusul sinkron
     lewat flag. Kalau tidak ada, prefers-reduced-motion: lampu
     langsung menyala tanpa animasi goyang — kartu ikut ke Daftar
     lewat jalur pusat yang sama, jadi kartu dan lampu tetap sinkron. */
  if (typeof window.__pendingAuthView === "string") {
    var pv = window.__pendingAuthView;
    window.__pendingAuthView = null;
    setAuthView(pv);
  } else if (reduceMotion) {
    setAuthView("register");
  } else {
    applyState();
  }
})();

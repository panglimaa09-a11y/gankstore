/* Lampu meja interaktif — halaman login (#/akun).
   Tarik tali (drag ke bawah) atau ketuk tali / kepala lampu untuk
   menyalakan atau mematikan lampu. Bunyi dengung mengikuti pola
   Web Audio dari referensi: sine 120 Hz, envelope 0.001 -> 0.06
   -> 0.001 selama ~0.35 detik, hanya saat user menarik/mengetuk.
   Animasi murni visual: form login tetap bisa dipakai walau lampu
   mati, dan tidak ada state login yang disimpan di sini. */
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
  var HINT_OFF = "Tarik talinya untuk menyalakan lampu";
  var HINT_ON = "Lampu menyala. Tarik lagi untuk mematikan.";

  function applyState(){
    stage.classList.toggle("on", on);
    wrap.classList.toggle("lamp-on", on);
    wrap.classList.toggle("lamp-dim", !on);
    cord.setAttribute("aria-pressed", on ? "true" : "false");
    cord.setAttribute("aria-label", on ? "Matikan lampu" : "Nyalakan lampu");
    if (hint) hint.textContent = on ? HINT_ON : HINT_OFF;
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

  function toggle(playSound){
    on = !on;
    applyState();
    if (playSound) hum();
    if (!reduceMotion) {
      cord.classList.remove("sway");
      void cord.offsetWidth;
      cord.classList.add("sway");
    }
  }

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

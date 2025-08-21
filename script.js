navigator.mediaDevices.getUserMedia({ audio: true })
.then(stream => {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();

  const counterEl = document.getElementById("counter");
  const initialCount = 10;
  let count = initialCount;
  const threshold = 0.25; // sensitivity (adjust if needed)
  let lastClap = 0;

  // Connect analyser for potential future use
  analyser.fftSize = 1024;
  source.connect(analyser);
  const timeDomain = new Float32Array(analyser.fftSize);

  function updateCounterDisplay() {
    counterEl.textContent = String(count);
  }

  function triggerCounterPop() {
    counterEl.classList.remove('pop');
    void counterEl.offsetWidth; // reflow to restart animation
    counterEl.classList.add('pop');
  }

  updateCounterDisplay();

  function tick() {
    requestAnimationFrame(tick);
    analyser.getFloatTimeDomainData(timeDomain);
    // Calculate volume (RMS)
    let sum = 0;
    for (let i = 0; i < timeDomain.length; i++) {
      const v = timeDomain[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / timeDomain.length);
    // Clap detection
    if (rms > threshold) {
      const now = Date.now();
      if (now - lastClap > 500) {
        if (count > 0) {
          count -= 1;
          updateCounterDisplay();
          triggerCounterPop();
        }
        if (count === 0) {
          setTimeout(() => {
            window.location.href = "https://www.example.com";
          }, 1200);
        }
        lastClap = now;
      }
    }
  }
  tick();
})
.catch(err => {
  console.error("Mic access denied:", err);
});
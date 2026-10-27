import confetti from 'canvas-confetti';

/**
 * ยิง Confetti เฉลิมฉลองด้วยชุดสี PANTONE (Very Peri, Ultra Violet, Peach Fuzz, Living Coral, Greenery)
 */
export function triggerPantoneConfetti() {
  const pantoneColors = ['#6667AB', '#5F4B8B', '#FFBE98', '#FF6F61', '#5B9E7D', '#9E91D3'];

  // Shot 1: Left Burst
  confetti({
    particleCount: 50,
    angle: 60,
    spread: 55,
    origin: { x: 0, y: 0.7 },
    colors: pantoneColors,
  });

  // Shot 2: Right Burst
  confetti({
    particleCount: 50,
    angle: 120,
    spread: 55,
    origin: { x: 1, y: 0.7 },
    colors: pantoneColors,
  });

  // Shot 3: Center starburst after 250ms
  setTimeout(() => {
    confetti({
      particleCount: 80,
      spread: 100,
      origin: { y: 0.6 },
      colors: pantoneColors,
    });
  }, 250);
}

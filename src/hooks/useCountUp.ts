import { useState, useEffect } from 'react';

/**
 * Hook สำหรับนับตัวเลขสถิติแบบนุ่มนวล (Count-Up Animation with easeOutExpo)
 * @param end ค่าเป้าหมาย
 * @param duration ระยะเวลา (มิลลิวินาที, ค่าเริ่มต้น 900ms)
 */
export function useCountUp(end: number, duration: number = 900): number {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const startValue = 0;
    const targetValue = end;

    if (targetValue === 0) {
      setCount(0);
      return;
    }

    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const elapsed = timestamp - startTimestamp;
      const progress = Math.min(elapsed / duration, 1);

      // easeOutExpo function
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = Math.floor(startValue + (targetValue - startValue) * easeProgress);

      setCount(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setCount(targetValue);
      }
    };

    animationFrameId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [end, duration]);

  return count;
}

import { useEffect, useState, useRef } from 'react';
import { Sparkles } from 'lucide-react';

interface AITypewriterProps {
  text: string;
  speed?: number; // ms per character, default 18
  className?: string;
  showIcon?: boolean;
  onComplete?: () => void;
}

export function AITypewriter({ text, speed = 18, className = '', showIcon = true, onComplete }: AITypewriterProps) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed('');
    setDone(false);
    if (!text) return;

    const timer = setInterval(() => {
      if (idx.current < text.length) {
        setDisplayed(text.slice(0, idx.current + 1));
        idx.current++;
      } else {
        setDone(true);
        clearInterval(timer);
        onComplete?.();
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return (
    <div className={`relative ${className}`}>
      {showIcon && (
        <div className="flex items-center gap-1.5 text-accent text-xs font-medium mb-2">
          <Sparkles size={12} className="animate-pulse" />
          <span>AI Generated</span>
        </div>
      )}
      <div className="whitespace-pre-wrap text-sm text-fg">
        {displayed}
        {!done && <span className="inline-block w-0.5 h-4 bg-accent animate-pulse ml-0.5 align-text-bottom" />}
      </div>
    </div>
  );
}

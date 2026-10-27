import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  title?: string;
}

export function CopyButton({
  text,
  label,
  className,
  title = 'คลิกเพื่อคัดลอก',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'คัดลอกเรียบร้อยแล้ว!' : title}
      className={cn(
        'group relative inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-all duration-200 active:scale-95',
        copied
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300'
          : 'text-slate-400 hover:bg-slate-100 hover:text-gov-700',
        className
      )}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-600 animate-pop-in" />
          <span className="text-[11px] font-semibold text-emerald-700">คัดลอกแล้ว</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3 transition-transform group-hover:scale-110" />
          {label && <span className="text-[11px]">{label}</span>}
        </>
      )}
    </button>
  );
}

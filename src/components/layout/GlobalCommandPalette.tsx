import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Package,
  Command,
  LayoutDashboard,
  QrCode,
  Repeat,
  ArrowLeftRight,
  Wrench,
  ClipboardCheck,
  Settings,
  ArrowRight,
  X,
  Building2,
  CornerDownLeft,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { ASSET_STATUS_META } from '@/lib/utils';
import type { Asset } from '@/types/database';

interface GlobalCommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const STATIC_NAV_COMMANDS = [
  { label: 'แดชบอร์ดภาพรวม', path: '/', icon: LayoutDashboard, category: 'เมนูหลัก' },
  { label: 'ทะเบียนครุภัณฑ์สำนักงาน', path: '/assets', icon: Package, category: 'เมนูหลัก' },
  { label: 'สแกน / พิมพ์ QR & Barcode', path: '/qr-barcode', icon: QrCode, category: 'เมนูหลัก' },
  { label: 'ระบบยืม-คืนครุภัณฑ์', path: '/borrowing', icon: Repeat, category: 'ธุรกรรมพัสดุ' },
  { label: 'โอนย้ายสถานที่และผู้รับผิดชอบ', path: '/transfers', icon: ArrowLeftRight, category: 'ธุรกรรมพัสดุ' },
  { label: 'แจ้งซ่อมและประวัติบำรุงรักษา', path: '/maintenance', icon: Wrench, category: 'ธุรกรรมพัสดุ' },
  { label: 'ตรวจนับครุภัณฑ์ประจำปี', path: '/inventory', icon: ClipboardCheck, category: 'ตรวจนับ' },
  { label: 'ตั้งค่าระบบและผู้ใช้งาน', path: '/settings', icon: Settings, category: 'ผู้ดูแลระบบ' },
];

export function GlobalCommandPalette({ open, onClose }: GlobalCommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [assetResults, setAssetResults] = useState<Asset[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setAssetResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Live search assets from Supabase
  useEffect(() => {
    if (!open || !query.trim() || query.length < 2) {
      setAssetResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      if (!isSupabaseConfigured()) return;
      setIsSearching(true);
      try {
        const cleanQuery = query.trim();
        const { data } = await supabase
          .from('assets')
          .select('id, asset_code, name, brand, model, serial_number, status, department:departments(name)')
          .or(`asset_code.ilike.%${cleanQuery}%,name.ilike.%${cleanQuery}%,brand.ilike.%${cleanQuery}%,model.ilike.%${cleanQuery}%,serial_number.ilike.%${cleanQuery}%`)
          .eq('is_archived', false)
          .limit(6);

        setAssetResults((data as unknown as Asset[]) || []);
      } catch {
        setAssetResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [query, open]);

  // Filter static navigation commands
  const filteredNav = query.trim()
    ? STATIC_NAV_COMMANDS.filter((cmd) =>
        cmd.label.toLowerCase().includes(query.toLowerCase())
      )
    : STATIC_NAV_COMMANDS;

  const totalItems = filteredNav.length + assetResults.length;

  // Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < totalItems ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : Math.max(0, totalItems - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex < filteredNav.length) {
        navigate(filteredNav[selectedIndex].path);
        onClose();
      } else {
        const assetIndex = selectedIndex - filteredNav.length;
        const asset = assetResults[assetIndex];
        if (asset) {
          navigate(`/assets/${asset.id}`);
          onClose();
        }
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-200/90 bg-white shadow-2xl overflow-hidden animate-pop-in ring-1 ring-slate-900/10">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3.5">
          <Search className="h-5 w-5 text-gov-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="ค้นหาเลขครุภัณฑ์, ชื่ออุปกรณ์, S/N หรือเมนูที่ต้องการ..."
            className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="rounded p-1 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 shadow-2xs">
              ESC
            </kbd>
          )}
        </div>

        {/* Results Area */}
        <div className="max-h-[60vh] overflow-y-auto p-2 divide-y divide-slate-100">
          {/* Asset search results if any */}
          {assetResults.length > 0 && (
            <div className="p-2 space-y-1">
              <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>ผลการค้นหาครุภัณฑ์</span>
                {isSearching && <span className="text-[10px] text-gov-600 animate-pulse">กำลังค้นหา...</span>}
              </div>
              {assetResults.map((asset, index) => {
                const itemIndex = filteredNav.length + index;
                const isSelected = selectedIndex === itemIndex;
                const statusMeta = ASSET_STATUS_META[asset.status];
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      navigate(`/assets/${asset.id}`);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    className={`flex w-full items-center justify-between rounded-xl p-2.5 text-left text-xs transition ${
                      isSelected ? 'bg-gov-50 text-gov-900 ring-1 ring-gov-200' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gov-100/70 text-gov-700">
                        <Package className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-gov-800">{asset.asset_code}</span>
                          {statusMeta && (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.2 text-[10px] font-medium ${statusMeta.badgeClass}`}>
                              <span className={`h-1 w-1 rounded-full ${statusMeta.dotClass}`} />
                              {statusMeta.label}
                            </span>
                          )}
                        </div>
                        <p className="truncate font-semibold text-slate-900 mt-0.5">{asset.name}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {[asset.brand, asset.model].filter(Boolean).join(' • ') || 'ไม่ระบุยี่ห้อ/รุ่น'}
                          {asset.department?.name ? ` • ${asset.department.name}` : ''}
                        </p>
                      </div>
                    </div>
                    <CornerDownLeft className={`h-4 w-4 shrink-0 transition ${isSelected ? 'text-gov-700 translate-x-0' : 'text-transparent -translate-x-1'}`} />
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick Nav Commands */}
          {filteredNav.length > 0 && (
            <div className="p-2 space-y-1">
              <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                ไปยังหน้าเมนู
              </div>
              {filteredNav.map((cmd, index) => {
                const isSelected = selectedIndex === index;
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.path}
                    type="button"
                    onClick={() => {
                      navigate(cmd.path);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex w-full items-center justify-between rounded-xl p-2.5 text-left text-xs transition ${
                      isSelected ? 'bg-gov-50 text-gov-900 ring-1 ring-gov-200' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{cmd.label}</p>
                        <p className="text-[11px] text-slate-400">{cmd.category}</p>
                      </div>
                    </div>
                    <ArrowRight className={`h-4 w-4 text-slate-400 transition ${isSelected ? 'text-gov-700 translate-x-1' : ''}`} />
                  </button>
                );
              })}
            </div>
          )}

          {totalItems === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              ไม่พบผลการค้นหาสำหรับ &quot;{query}&quot;
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-sans font-medium shadow-2xs">↑</kbd>
              <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-sans font-medium shadow-2xs">↓</kbd>
              <span>เพื่อเลื่อนเลือก</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-sans font-medium shadow-2xs">↵</kbd>
              <span>เพื่อเปิดรายการ</span>
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">กด ESC เพื่อปิด</span>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import JsBarcode from 'jsbarcode';
import { Html5Qrcode } from 'html5-qrcode';
import { toast } from 'sonner';
import {
  Camera,
  CameraOff,
  Printer,
  QrCode,
  Search,
  Eye,
  CheckSquare,
  Square,
  AlertTriangle,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { ASSET_STATUS_META } from '@/lib/utils';
import { useSystemSettings } from '@/hooks/useMasterData';
import { EmptyState, LoadingState, PageHeader, StatusBadge } from '@/components/ui/common';
import type { Asset } from '@/types/database';

function Code128Barcode({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: 1.4,
          height: 36,
          displayValue: true,
          fontSize: 11,
          margin: 4,
        });
      } catch (err) {
        console.warn('Barcode render error:', err);
      }
    }
  }, [value]);

  return <svg ref={svgRef} className="mx-auto max-w-full" />;
}

export function QrBarcodePage() {
  const [searchParams] = useSearchParams();
  const preselectAssetId = searchParams.get('assetId');
  const configured = isSupabaseConfigured();
  const { data: settings } = useSystemSettings();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    preselectAssetId ? new Set([preselectAssetId]) : new Set()
  );
  const [filterText, setFilterText] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [scannedAsset, setScannedAsset] = useState<Asset | null>(null);
  const [scanNotFound, setScanNotFound] = useState<string | null>(null);

  // Camera Scanner State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets-list'],
    queryFn: async () => {
      if (!configured) return [] as Asset[];
      const { data, error } = await supabase
        .from('assets')
        .select('*, category:asset_categories(*), department:departments(*), location:locations(*)')
        .eq('is_archived', false)
        .order('asset_code', { ascending: true });
      if (error) throw error;
      return (data || []) as Asset[];
    },
  });

  useEffect(() => {
    if (preselectAssetId) {
      setSelectedIds(new Set([preselectAssetId]));
    }
  }, [preselectAssetId]);

  // ค้นหาครุภัณฑ์จากค่าที่สแกนได้ (รองรับทั้ง URL เต็ม, UUID หรือ เลขครุภัณฑ์)
  const lookupScannedCode = (rawCode: string) => {
    const clean = rawCode.trim();
    if (!clean) return;

    setScanNotFound(null);
    let extractedIdOrCode = clean;

    if (clean.includes('/assets/')) {
      const parts = clean.split('/assets/');
      extractedIdOrCode = parts[parts.length - 1].split('?')[0].trim();
    }

    const found = assets.find(
      (a) =>
        a.id.toLowerCase() === extractedIdOrCode.toLowerCase() ||
        a.asset_code.toLowerCase() === extractedIdOrCode.toLowerCase() ||
        (a.serial_number || '').toLowerCase() === extractedIdOrCode.toLowerCase()
    );

    if (found) {
      setScannedAsset(found);
      toast.success(`พบครุภัณฑ์: ${found.asset_code} (${found.name})`);
    } else {
      setScannedAsset(null);
      setScanNotFound(`ไม่พบข้อมูลครุภัณฑ์ที่ตรงกับรหัส "${clean}" ในระบบ`);
      toast.error(`ไม่พบรหัสครุภัณฑ์ "${clean}"`);
    }
  };

  const startCameraScanner = async () => {
    setCameraError(null);
    try {
      const html5QrCode = new Html5Qrcode('qr-reader-viewport');
      scannerRef.current = html5QrCode;
      setCameraActive(true);

      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          lookupScannedCode(decodedText);
          stopCameraScanner();
        },
        () => {
          // ignore frame scan errors
        }
      );
    } catch (err) {
      setCameraActive(false);
      const errMsg = String(err);
      if (errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('notallowed')) {
        setCameraError('เบราว์เซอร์ไม่ได้รับอนุญาตให้เข้าถึงกล้อง กรุณาอนุญาตสิทธิ์การใช้กล้อง หรือใช้ช่องกรอกรหัสจากเครื่องสแกน Barcode แทน');
      } else {
        setCameraError('อุปกรณ์นี้ไม่รองรับการเปิดกล้องสแกนโดยตรง กรุณาใช้เครื่องสแกน Barcode (USB/Bluetooth) หรือกรอกรหัสครุภัณฑ์ด้านล่าง');
      }
    }
  };

  const stopCameraScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // ignore stop error
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const toggleSelectAsset = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredAssets = assets.filter((a) => {
    const q = filterText.trim().toLowerCase();
    if (!q) return true;
    return (
      a.asset_code.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      (a.department?.name || '').toLowerCase().includes(q)
    );
  });

  const selectedAssets = assets.filter((a) => selectedIds.has(a.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="ระบบจัดการ QR Code & Barcode ครุภัณฑ์"
        subtitle="สแกนค้นหาครุภัณฑ์ด้วยกล้องหรือเครื่องอ่านบาร์โค้ด และสร้างฉลากมาตรฐานสำหรับพิมพ์ติดครุภัณฑ์"
        actions={
          <button
            type="button"
            disabled={selectedAssets.length === 0}
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            พิมพ์ฉลากที่เลือก ({selectedAssets.length} รายการ)
          </button>
        }
      />

      {/* ส่วนที่ 1: สแกนค้นหาครุภัณฑ์ (กล้อง + เครื่องอ่าน Barcode โหมดคีย์บอร์ด) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 print:hidden">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                สแกนค้นหาครุภัณฑ์ (QR Code / Barcode Scanner)
              </h2>
              <p className="text-xs text-slate-500">
                รองรับทั้งการสแกนผ่านกล้องโทรศัพท์มือถือ และเครื่องอ่าน Barcode แบบ USB/ไร้สาย
              </p>
            </div>
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCameraScanner}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
              >
                <Camera className="h-4 w-4" />
                เปิดกล้องสแกน
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCameraScanner}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
              >
                <CameraOff className="h-4 w-4" />
                ปิดกล้อง
              </button>
            )}
          </div>

          {/* พื้นที่แสดงกล้อง */}
          <div
            id="qr-reader-viewport"
            className={cameraActive ? 'mx-auto max-w-sm overflow-hidden rounded-xl border border-slate-300' : 'hidden'}
          />

          {cameraError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* ช่องรับค่าจากเครื่องยิง Barcode หรือพิมพ์ค้นหา */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookupScannedCode(scanInput);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <QrCode className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="ยิงเครื่องสแกน Barcode ที่นี่ หรือกรอกเลขครุภัณฑ์ / Asset ID แล้วกด Enter..."
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-gov-600 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-900"
            >
              ค้นหารหัส
            </button>
          </form>
        </div>

        {/* ผลลัพธ์จากการสแกน */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <h2 className="text-base font-bold text-slate-900">ผลการค้นหาครุภัณฑ์จากการสแกน</h2>
          {scannedAsset ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-xs font-bold text-gov-700">
                    {scannedAsset.asset_code}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">{scannedAsset.name}</h3>
                </div>
                <StatusBadge
                  label={ASSET_STATUS_META[scannedAsset.status]?.label || scannedAsset.status}
                  className={ASSET_STATUS_META[scannedAsset.status]?.badgeClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                <p>หมวดหมู่: <strong>{scannedAsset.category?.name || '-'}</strong></p>
                <p>หน่วยงาน: <strong>{scannedAsset.department?.name || '-'}</strong></p>
                <p>สถานที่ตั้ง: <strong>{scannedAsset.location?.name || '-'}</strong></p>
                <p>Serial: <strong>{scannedAsset.serial_number || '-'}</strong></p>
              </div>
              <div className="pt-2 flex gap-2">
                <Link
                  to={`/assets/${scannedAsset.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
                >
                  <Eye className="h-3.5 w-3.5" />
                  เปิดดูรายละเอียดครุภัณฑ์
                </Link>
              </div>
            </div>
          ) : scanNotFound ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
              {scanNotFound}
            </div>
          ) : (
            <div className="mt-4 flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
              สแกน QR Code หรือยิง Barcode เพื่อแสดงข้อมูลครุภัณฑ์ทันที
            </div>
          )}
        </div>
      </div>

      {/* ส่วนที่ 2: เลือกรายการครุภัณฑ์และตัวอย่างฉลากสำหรับพิมพ์ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* รายการเลือกครุภัณฑ์ (ซ่อนเวลาสั่งพิมพ์) */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3 print:hidden">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">เลือกรายการครุภัณฑ์เพื่อพิมพ์ฉลาก</h3>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSelectedIds(new Set(filteredAssets.map((a) => a.id)))}
                className="text-gov-700 hover:underline font-medium"
              >
                เลือกทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-slate-500 hover:underline"
              >
                ล้าง
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="กรองเลขครุภัณฑ์ หรือชื่อ..."
              className="w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-xs"
            />
          </div>

          {isLoading ? (
            <LoadingState message="กำลังโหลดครุภัณฑ์..." />
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {filteredAssets.map((a) => {
                const checked = selectedIds.has(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleSelectAsset(a.id)}
                    className={`flex w-full items-start gap-2.5 p-2.5 text-left text-xs transition ${
                      checked ? 'bg-gov-50/80' : 'hover:bg-slate-50'
                    }`}
                  >
                    {checked ? (
                      <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-gov-700" />
                    ) : (
                      <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0">
                      <p className="font-mono font-semibold text-gov-800">{a.asset_code}</p>
                      <p className="truncate text-slate-700">{a.name}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ตัวอย่างฉลากพร้อมพิมพ์ */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs print:border-0 print:p-0 print:shadow-none">
          <div className="mb-4 flex items-center justify-between print:hidden">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                ตัวอย่างฉลากครุภัณฑ์มาตรฐาน (QR Code + Code 128 Barcode)
              </h3>
              <p className="text-xs text-slate-500">
                ฉลากแสดงเฉพาะชื่อหน่วยงาน เลขครุภัณฑ์ ชื่อรายการ และรหัสอ้างอิงที่ปลอดภัย
              </p>
            </div>
          </div>

          {selectedAssets.length === 0 ? (
            <EmptyState
              title="ยังไม่ได้เลือกรายการครุภัณฑ์"
              description="คลิกเลือกรายการครุภัณฑ์จากตารางด้านซ้าย เพื่อสร้างฉลาก QR Code และ Barcode สำหรับสั่งพิมพ์"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
              {selectedAssets.map((asset) => {
                const qrUrl = `${window.location.origin}/assets/${asset.id}`;
                return (
                  <div
                    key={asset.id}
                    className="flex flex-col justify-between rounded-xl border-2 border-slate-800 bg-white p-4 break-inside-avoid"
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-300 pb-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-gov-800 uppercase truncate">
                          {settings?.org_name || 'สำนักงานบริหารงานพัสดุและครุภัณฑ์กลาง'}
                        </p>
                        <p className="mt-0.5 font-mono text-xs font-bold text-slate-900">
                          {asset.asset_code}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-slate-700 line-clamp-2">
                          {asset.name}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          หน่วยงาน: {asset.department?.name || '-'}
                        </p>
                      </div>
                      <div className="shrink-0 rounded border border-slate-200 p-1 bg-white">
                        <QRCodeSVG value={qrUrl} size={68} level="M" />
                      </div>
                    </div>

                    <div className="pt-2 text-center">
                      <Code128Barcode value={asset.asset_code} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

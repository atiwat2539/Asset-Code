import React from 'react';
import { Link } from 'react-router-dom';
import {
  X,
  ExternalLink,
  QrCode,
  Building2,
  MapPin,
  User,
  Calendar,
  Banknote,
  Package,
  Layers,
  FileText,
} from 'lucide-react';
import { ASSET_STATUS_META, formatCurrency } from '@/lib/utils';
import { formatThaiDate } from '@/lib/date';
import { StatusBadge } from '@/components/ui/common';
import { CopyButton } from '@/components/ui/CopyButton';
import type { Asset } from '@/types/database';

interface AssetQuickViewDrawerProps {
  asset: Asset | null;
  onClose: () => void;
}

export function AssetQuickViewDrawer({ asset, onClose }: AssetQuickViewDrawerProps) {
  if (!asset) return null;

  const statusMeta = ASSET_STATUS_META[asset.status];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-drawer-right border-l border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-gov-50/50 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-gov-800 bg-gov-100/80 px-2 py-0.5 rounded">
                {asset.asset_code}
              </span>
              <CopyButton text={asset.asset_code} />
            </div>
            <p className="mt-1 text-xs text-slate-500">พรีวิวข้อมูลครุภัณฑ์ด่วน (Quick View)</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            aria-label="ปิด"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Photo & Status */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {asset.image_url ? (
              <img
                src={asset.image_url}
                alt={asset.name}
                className="h-52 w-full object-cover"
              />
            ) : (
              <div className="flex h-44 w-full flex-col items-center justify-center gap-2 text-slate-400">
                <Package className="h-10 w-10 text-slate-300" />
                <span className="text-xs">ไม่มีรูปภาพครุภัณฑ์</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-200 bg-white p-3">
              <StatusBadge
                label={statusMeta?.label || asset.status}
                className={statusMeta?.badgeClass}
                dotClass={statusMeta?.dotClass}
                pulseDot={asset.status === 'under_maintenance'}
              />
              <span className="text-sm font-bold text-emerald-700">
                {formatCurrency(asset.unit_price)}
              </span>
            </div>
          </div>

          {/* Title & Specs */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 leading-snug">{asset.name}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">
                {[asset.brand, asset.model].filter(Boolean).join(' • ') || 'ไม่ระบุยี่ห้อ/รุ่น'}
              </span>
              {asset.serial_number && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="inline-flex items-center gap-1 font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                    S/N: {asset.serial_number}
                    <CopyButton text={asset.serial_number} />
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Info Grid */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 text-xs">
            <div className="flex items-start gap-2.5">
              <Layers className="h-4 w-4 text-gov-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-slate-400">หมวดหมู่ครุภัณฑ์</p>
                <p className="font-medium text-slate-800">{asset.category?.name || '-'}</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Building2 className="h-4 w-4 text-gov-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-slate-400">หน่วยงานที่ครอบครอง</p>
                <p className="font-medium text-slate-800">{asset.department?.name || '-'}</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <MapPin className="h-4 w-4 text-gov-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-slate-400">สถานที่จัดวาง / ห้อง</p>
                <p className="font-medium text-slate-800">
                  {asset.location
                    ? `${asset.location.building} ห้อง ${asset.location.room || '-'}`
                    : '-'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <User className="h-4 w-4 text-gov-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-slate-400">ผู้รับผิดชอบ / ผู้ดูแล</p>
                <p className="font-medium text-slate-800">{asset.custodian?.full_name || 'ไม่ระบุ'}</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Calendar className="h-4 w-4 text-gov-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-slate-400">วันที่รับเข้า / อายุการใช้งาน</p>
                <p className="font-medium text-slate-800">
                  {formatThaiDate(asset.acquired_date)} (อายุ {asset.useful_life_years || 5} ปี)
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          {asset.description && (
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs">
              <div className="flex items-center gap-1.5 text-slate-500 font-semibold mb-1">
                <FileText className="h-3.5 w-3.5" />
                คุณลักษณะเฉพาะ:
              </div>
              <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                {asset.description}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3">
          <Link
            to={`/qr-barcode?assetId=${asset.id}`}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            <QrCode className="h-4 w-4 text-gov-700" />
            พิมพ์ QR / Barcode
          </Link>

          <Link
            to={`/assets/${asset.id}`}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-gov-800 transition"
          >
            เปิดหน้ารายละเอียดเต็ม
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

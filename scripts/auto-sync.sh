#!/bin/sh
set -e

COMMIT_MSG="${1:-chore: อัปเดตโค้ดระบบบริหารจัดการครุภัณฑ์สำนักงาน}"

echo "🔍 1. ตรวจสอบความปลอดภัยว่าไม่มีไฟล์ .env หลุดเข้า Git..."
git add -A

if git diff --cached --quiet; then
  echo "ℹ️ ไม่มีไฟล์ที่เปลี่ยนแปลงใหม่"
  exit 0
fi

echo "📦 2. บันทึก Commit: $COMMIT_MSG"
git commit -m "$COMMIT_MSG"

if [ -f "scripts/sync-supabase.mjs" ]; then
  echo "🗄️ 2.5 อัปเดตโครงสร้างฐานข้อมูลเข้า Supabase อัตโนมัติ..."
  node scripts/sync-supabase.mjs
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "⚠️ ยังไม่ได้ผูก GitHub Remote URL (origin) กรุณารัน: git remote add origin <GITHUB_REPO_URL>"
  exit 0
fi

echo "🚀 3. กำลังส่งโค้ดขึ้น GitHub (origin main)..."
git push -u origin main

echo "✅ โค้ดถูก Commit และส่งขึ้น GitHub เรียบร้อยแล้ว!"

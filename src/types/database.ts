export type UserRole = 'admin' | 'asset_officer' | 'requester';

export type AssetStatus =
  | 'available'
  | 'borrowed'
  | 'under_maintenance'
  | 'pending_disposal'
  | 'disposed'
  | 'lost';

export type BorrowStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'borrowed'
  | 'returned'
  | 'overdue'
  | 'cancelled';

export type TransferStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type MaintenanceStatus =
  | 'pending'
  | 'approved'
  | 'in_progress'
  | 'waiting_parts'
  | 'completed'
  | 'unrepairable'
  | 'cancelled';

export type MaintenanceUrgency = 'low' | 'medium' | 'high' | 'critical';

export type InventorySessionStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export type InventoryResultStatus =
  | 'found_normal'
  | 'not_found'
  | 'found_mismatch'
  | 'damaged'
  | 'needs_review';

export type DisposalStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'disposed';

export type DisposalReasonType =
  | 'deteriorated'
  | 'damaged_beyond_repair'
  | 'obsolete'
  | 'lost'
  | 'other';

export type EventCategory =
  | 'meeting'
  | 'inventory'
  | 'maintenance'
  | 'training'
  | 'due_date'
  | 'general';

export interface Department {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  department_id: string | null;
  code: string;
  building: string;
  floor: string | null;
  room: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  department?: Department | null;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  department_id: string | null;
  position: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  department?: Department | null;
}

export interface AssetCategory {
  id: string;
  code: string;
  name: string;
  useful_life_years: number;
  depreciation_rate: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  asset_code: string;
  name: string;
  category_id: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  description: string | null;
  unit_price: number;
  acquired_date: string | null;
  contract_number: string | null;
  useful_life_years: number | null;
  status: AssetStatus;
  department_id: string;
  location_id: string | null;
  custodian_id: string | null;
  image_url: string | null;
  notes: string | null;
  is_archived: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  category?: AssetCategory | null;
  department?: Department | null;
  location?: Location | null;
  custodian?: Profile | null;
}

export interface AssetAttachment {
  id: string;
  asset_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  bucket_name: 'asset-images' | 'asset-documents' | 'maintenance-attachments' | 'disposal-attachments';
  category: 'image' | 'procurement' | 'inspection' | 'warranty' | 'manual' | 'general';
  uploaded_by: string | null;
  created_at: string;
  uploader?: Profile | null;
}

export interface AssetTransfer {
  id: string;
  transfer_no: string;
  asset_id: string;
  from_department_id: string | null;
  to_department_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_custodian_id: string | null;
  to_custodian_id: string | null;
  reason: string;
  effective_date: string;
  status: TransferStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  attachment_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  asset?: Asset | null;
  from_department?: Department | null;
  to_department?: Department | null;
  from_location?: Location | null;
  to_location?: Location | null;
  from_custodian?: Profile | null;
  to_custodian?: Profile | null;
  requester?: Profile | null;
  approver?: Profile | null;
}

export interface BorrowRequest {
  id: string;
  request_no: string;
  asset_id: string;
  requester_id: string;
  department_id: string | null;
  purpose: string;
  borrow_date: string;
  expected_return_date: string;
  actual_pickup_date: string | null;
  actual_return_date: string | null;
  status: BorrowStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  asset?: Asset | null;
  requester?: Profile | null;
  department?: Department | null;
  approver?: Profile | null;
}

export interface BorrowTransaction {
  id: string;
  borrow_request_id: string;
  asset_id: string;
  action_type: 'checkout' | 'checkin';
  action_date: string;
  handled_by: string | null;
  borrower_id: string | null;
  asset_condition: 'normal' | 'minor_damage' | 'damaged' | 'lost';
  condition_notes: string | null;
  created_at: string;
  handler?: Profile | null;
  borrower?: Profile | null;
}

export interface MaintenanceRequest {
  id: string;
  ticket_no: string;
  asset_id: string;
  reported_by: string;
  reported_date: string;
  issue_description: string;
  urgency: MaintenanceUrgency;
  status: MaintenanceStatus;
  assigned_to: string | null;
  vendor_name: string | null;
  estimated_cost: number;
  actual_cost: number;
  sent_date: string | null;
  completed_date: string | null;
  resolution_notes: string | null;
  attachment_path: string | null;
  created_at: string;
  updated_at: string;
  asset?: Asset | null;
  reporter?: Profile | null;
  assignee?: Profile | null;
}

export interface MaintenanceLog {
  id: string;
  maintenance_request_id: string;
  asset_id: string;
  action_date: string;
  status_from: string | null;
  status_to: string;
  cost: number;
  vendor_name: string | null;
  description: string;
  performed_by: string | null;
  created_at: string;
  performer?: Profile | null;
}

export interface InventorySession {
  id: string;
  session_code: string;
  name: string;
  fiscal_year: number;
  start_date: string;
  end_date: string;
  department_id: string | null;
  status: InventorySessionStatus;
  responsible_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  department?: Department | null;
  responsible?: Profile | null;
}

export interface InventoryItem {
  id: string;
  session_id: string;
  asset_id: string;
  expected_location_id: string | null;
  actual_location_id: string | null;
  result_status: InventoryResultStatus;
  inspected_by: string | null;
  inspected_at: string;
  notes: string | null;
  evidence_path: string | null;
  created_at: string;
  updated_at: string;
  asset?: Asset | null;
  expected_location?: Location | null;
  actual_location?: Location | null;
  inspector?: Profile | null;
}

export interface DisposalRequest {
  id: string;
  disposal_no: string;
  asset_id: string;
  reason_type: DisposalReasonType;
  reason_detail: string;
  proposed_by: string;
  proposed_date: string;
  status: DisposalStatus;
  reviewed_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  document_no: string | null;
  disposal_date: string | null;
  disposal_method: 'sale' | 'transfer_out' | 'destroy' | 'write_off' | null;
  salvage_value: number;
  attachment_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  asset?: Asset | null;
  proposer?: Profile | null;
  approver?: Profile | null;
}

export interface CorporateEvent {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  organizer_id: string | null;
  participants: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  organizer?: Profile | null;
}

export interface SystemSettings {
  id: string;
  org_name: string;
  org_short_name: string;
  org_address: string | null;
  org_phone: string | null;
  org_email: string | null;
  logo_url: string | null;
  asset_code_prefix: string;
  asset_code_format: string;
  current_fiscal_year: number;
  borrow_reminder_days: number;
  timezone: string;
  date_format: string;
  updated_by: string | null;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

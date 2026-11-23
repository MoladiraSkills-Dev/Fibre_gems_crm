import { pgTable, uuid, text, timestamp, date, integer, boolean, jsonb, pgEnum, doublePrecision, bigint } from "drizzle-orm/pg-core";

export const appRoleEnum = pgEnum("app_role", ["admin", "team_leader", "agent"]);
export const customerStatusEnum = pgEnum("customer_status", [
  "new_lead",
  "contacted",
  "qualified",
  "order_submitted",
  "payment_pending",
  "activation_pending",
  "activated",
  "lost",
]);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentCode: text("agent_code").unique(),
  phoneLogin: text("phone_login"),
  phonePass: text("phone_pass"),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  status: text("status").notNull().default("active"),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  role: appRoleEnum("role").notNull().default("agent"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalCustomerId: text("external_customer_id").unique(),
  recordStatus: text("record_status").notNull().default("active"),
  firstName: text("first_name").notNull(),
  surname: text("surname").notNull(),
  fullName: text("full_name"),
  cellNumber: text("cell_number").notNull(),
  normalizedCell: text("normalized_cell").notNull().unique(),
  alternateCellNumber: text("alternate_cell_number"),
  email: text("email"),
  fullAddress: text("full_address"),
  areaSuburb: text("area_suburb"),
  productPackage: text("product_package"),
  paymentType: text("payment_type"),
  easypayNumber: text("easypay_number"),
  easypayCycle: integer("easypay_cycle"),
  easypayExpiry: date("easypay_expiry"),
  referralCode: text("referral_code").unique(),
  referredByCode: text("referred_by_code"),
  vicidialLeadId: text("vicidial_lead_id"),
  ownerId: uuid("owner_id").notNull().references(() => profiles.id),
  originalAgentId: uuid("original_agent_id").notNull().references(() => profiles.id),
  teamLeaderId: uuid("team_leader_id").references(() => profiles.id),
  status: text("status").notNull().default("new_lead"),
  nextAction: text("next_action"),
  nextActionDate: date("next_action_date"),
  lastContactDate: date("last_contact_date"),
  createdBy: uuid("created_by").notNull().references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  externalOrderId: text("external_order_id").unique(),
  orderDate: date("order_date"),
  ovrNumber: text("ovr_number").unique(),
  ovkNumber: text("ovk_number").unique(),
  status: text("status").notNull().default("pending"),
  nextAction: text("next_action"),
  actionDate: date("action_date"),
  source: text("source").notNull().default("crm"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  promisedPaymentDate: date("promised_payment_date"),
  paymentDate: date("payment_date"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activations = pgTable("activations", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  activationDate: date("activation_date"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull().references(() => profiles.id),
  actionType: text("action_type").notNull(),
  contactMethod: text("contact_method"),
  outcome: text("outcome"),
  customerStatusAfter: text("customer_status_after"),
  nextAction: text("next_action"),
  nextActionDate: date("next_action_date"),
  escalationType: text("escalation_type"),
  escalationReason: text("escalation_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyAgentActivity = pgTable("daily_agent_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => profiles.id),
  activityDate: date("activity_date").notNull().defaultNow(),
  touchCount: integer("touch_count").notNull().default(0),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productMappings = pgTable("product_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceProduct: text("source_product").notNull().unique(),
  crmProduct: text("crm_product").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agilityImportBatches = pgTable("agility_import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull().unique(),
  status: text("status").notNull().default("staged"),
  rowCount: integer("row_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  uploadedBy: uuid("uploaded_by").notNull().references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
});

export const agilityImportRows = pgTable("agility_import_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => agilityImportBatches.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  rawData: jsonb("raw_data").notNull(),
  ovrNumber: text("ovr_number"),
  ovkNumber: text("ovk_number"),
  validationStatus: text("validation_status").notNull().default("pending"),
  validationErrors: jsonb("validation_errors").notNull().default([]),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
});

export const agilityOrders = pgTable("agility_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderRef: text("order_ref").notNull().unique(),
  description: text("description"),
  status: text("status").notNull(),
  customStatus: text("custom_status"),
  premiseId: bigint("premise_id", { mode: "number" }),
  customerName: text("customer_name"),
  supplier: text("supplier"),
  product: text("product"),
  channelPartner: text("channel_partner"),
  agentNameRaw: text("agent_name_raw"),
  agentNameKey: text("agent_name_key"),
  orderCreatedDate: timestamp("order_created_date", { withTimezone: true }),
  paymentReceivedDate: timestamp("payment_received_date", { withTimezone: true }),
  completedDate: timestamp("completed_date", { withTimezone: true }),
  importBatchId: uuid("import_batch_id").references(() => agilityImportBatches.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agilityLeads = pgTable("agility_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadEntityId: bigint("lead_entity_id", { mode: "number" }).notNull().unique(),
  leadNumber: text("lead_number").notNull().unique(),
  leadDescription: text("lead_description"),
  orderRef: text("order_ref"),
  accountNumber: text("account_number"),
  accountName: text("account_name"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactNumberRaw: text("contact_number_raw"),
  contactNumber: text("contact_number"),
  altNumberRaw: text("alt_number_raw"),
  idNumber: text("id_number"),
  address: text("address"),
  region: text("region"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  status: text("status").notNull(),
  customStatus: text("custom_status"),
  source: text("source"),
  productName: text("product_name"),
  productCode: text("product_code"),
  supplier: text("supplier"),
  recurringExcl: doublePrecision("recurring_excl"),
  recurringIncl: doublePrecision("recurring_incl"),
  debitOrderDay: integer("debit_order_day"),
  kycStatus: text("kyc_status"),
  kycRequired: boolean("kyc_required"),
  channelPartnerCode: text("channel_partner_code"),
  agentNameRaw: text("agent_name_raw"),
  agentNameKey: text("agent_name_key"),
  salesAgent: text("sales_agent"),
  premiseId: bigint("premise_id", { mode: "number" }),
  auditCreatedDate: timestamp("audit_created_date", { withTimezone: true }),
  originalOrderDate: timestamp("original_order_date", { withTimezone: true }),
  submittedDate: timestamp("submitted_date", { withTimezone: true }),
  assignedDate: timestamp("assigned_date", { withTimezone: true }),
  auditUpdatedDate: timestamp("audit_updated_date", { withTimezone: true }),
  expiredDate: timestamp("expired_date", { withTimezone: true }),
  nextPaymentDate: timestamp("next_payment_date", { withTimezone: true }),
  vicidialLeadId: text("vicidial_lead_id"),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
  importBatchId: uuid("import_batch_id").references(() => agilityImportBatches.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agilityAgentMap = pgTable("agility_agent_map", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentNameKey: text("agent_name_key").notNull().unique(),
  agentNameRaw: text("agent_name_raw").notNull(),
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  displayName: text("display_name"),
  matchType: text("match_type").notNull().default("unmatched"),
  agentStatus: text("agent_status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignCode: text("campaign_code").notNull().unique(),
  name: text("name").notNull(),
  campaignCid: text("campaign_cid").notNull(),
  description: text("description").notNull().default(""),
  active: boolean("active").notNull().default(true),
  dialMethod: text("dial_method").notNull().default("RATIO"),
  autoDialLevel: doublePrecision("auto_dial_level").notNull().default(1.5),
  ringingTimeout: integer("ringing_timeout").notNull().default(25),
  hopperLevel: integer("hopper_level").notNull().default(200),
  forceRecording: boolean("force_recording").notNull().default(true),
  amdEnabled: boolean("amd_enabled").notNull().default(true),
  autoAlternateCell: boolean("auto_alternate_cell").notNull().default(true),
  blendedInbound: boolean("blended_inbound").notNull().default(false),
  retryRules: jsonb("retry_rules").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leadLists = pgTable("lead_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  listCode: text("list_code").notNull().unique(),
  name: text("name").notNull(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  vicidialListId: text("vicidial_list_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leadListLeads = pgTable("lead_list_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  listId: uuid("list_id").notNull().references(() => leadLists.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull().default(""),
  surname: text("surname").notNull().default(""),
  cellNumber: text("cell_number").notNull(),
  normalizedCell: text("normalized_cell").notNull(),
  alternateCell: text("alternate_cell"),
  email: text("email"),
  address: text("address"),
  suburb: text("suburb"),
  productPackage: text("product_package"),
  easypayNumber: text("easypay_number"),
  vicidialLeadId: text("vicidial_lead_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const callEvents = pgTable("call_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => profiles.id),
  vicidialLeadId: text("vicidial_lead_id"),
  phoneNumber: text("phone_number").notNull(),
  direction: text("direction").notNull().default("outbound"),
  status: text("status").notNull().default("dialing"),
  disposition: text("disposition"),
  durationSeconds: integer("duration_seconds"),
  notes: text("notes"),
  recordingUrl: text("recording_url"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  raw: jsonb("raw"),
});

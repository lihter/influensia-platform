CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "supplier";
--> statement-breakpoint
CREATE TABLE "app"."activity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."artworks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"file_id" uuid,
	"dieline_file_id" uuid,
	"status" text DEFAULT 'submitted' NOT NULL,
	"client_note" text,
	"internal_note" text,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"approved_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"author_id" text,
	"author_name" text,
	"body" text NOT NULL,
	"kind" text DEFAULT 'update' NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"counterparty" text,
	"occurred_at" timestamp with time zone,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"kind" text NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"uploaded_by" text,
	"published_at" timestamp with time zone,
	"published_by" text,
	"leak_check_result" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."factory_range_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"range_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"clean_image_file_id" uuid,
	"moq" integer,
	"price_minor_e2" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"made_here" boolean,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."factory_ranges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"label" text,
	"pdf_source_file_id" uuid,
	"pdf_file_id" uuid,
	"approved_by" text,
	"published_at" timestamp with time zone,
	"leak_check_result" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "factory_ranges_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "app"."files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text NOT NULL,
	"exif_stripped" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "app"."fx_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" real NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"po_id" uuid,
	"inspector" text,
	"scheduled_for" date,
	"inspected_at" timestamp with time zone,
	"aql" text,
	"sample_size" integer,
	"result" text,
	"defects_note" text,
	"report_document_id" uuid,
	"visible_to_client" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."notification_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"to_email" text,
	"channel" text DEFAULT 'email' NOT NULL,
	"template" text NOT NULL,
	"subject" text,
	"entity_ref" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "app"."offer_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"participation_id" uuid,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"moq" integer,
	"lead_days" integer,
	"price_breaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"factory_price_minor_e2" integer,
	"deviations_plain" text,
	"sample_cost_minor" integer,
	"sample_paid_by" text,
	"sample_required" boolean DEFAULT true NOT NULL,
	"payment_terms_client" text,
	"margin_rule_id" uuid,
	"internal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"org_id" uuid NOT NULL,
	"request_line_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pricing_display" text DEFAULT 'factory_plus_fee' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"incoterm" text,
	"port" text,
	"note_to_client" text,
	"valid_until" date,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"accepted_option_id" uuid,
	"decline_reason" text,
	"changes_text" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "offers_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "app"."order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"request_line_id" uuid NOT NULL,
	"product_id" uuid,
	"spec_version" integer,
	"line_no" integer DEFAULT 1 NOT NULL,
	"qty" integer NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"unit_price_minor_e2" integer NOT NULL,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"factory_unit_price_minor_e2" integer,
	"participation_id" uuid,
	"po_id" uuid,
	"artwork_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid,
	"commercial_mode" text NOT NULL,
	"pricing_display" text NOT NULL,
	"incoterm" text,
	"port" text,
	"pi_number" text,
	"state" text DEFAULT 'order_confirmed' NOT NULL,
	"milestone" text DEFAULT 'order_confirmed' NOT NULL,
	"exception" text,
	"exception_reason" text,
	"confirmed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"deposit_pct" integer DEFAULT 30 NOT NULL,
	"assigned_agent_id" text,
	"stale_since" timestamp with time zone,
	"last_state_change_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "orders_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "app"."organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"vat_id" text,
	"language" text DEFAULT 'en' NOT NULL,
	"currency_display" text DEFAULT 'USD' NOT NULL,
	"default_incoterm" text DEFAULT 'FOB' NOT NULL,
	"commercial_mode" text DEFAULT 'agency_passthrough' NOT NULL,
	"pricing_display" text DEFAULT 'factory_plus_fee' NOT NULL,
	"deposit_pct" integer DEFAULT 30 NOT NULL,
	"timezone" text DEFAULT 'Europe/Warsaw' NOT NULL,
	"partner_org_id" uuid,
	"auth_org_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_auth_org_id_unique" UNIQUE("auth_org_id")
);
--> statement-breakpoint
CREATE TABLE "app"."payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid,
	"request_line_id" uuid,
	"kind" text NOT NULL,
	"pct" integer,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payee" text DEFAULT 'agency' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_on" date,
	"paid_at" timestamp with time zone,
	"reference" text,
	"recorded_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."pricing_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'category' NOT NULL,
	"category" text NOT NULL,
	"min_value_minor" integer,
	"margin_pct" real NOT NULL,
	"fee_pct" real NOT NULL,
	"uplift_pct" real NOT NULL,
	"rounding" integer DEFAULT 2 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pricing_rules_category_unique" UNIQUE("category")
);
--> statement-breakpoint
CREATE TABLE "app"."product_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."product_specs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frozen_at" timestamp with time zone,
	"frozen_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"owner_org_id" uuid,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"hs_code" text,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"reference_price_minor_e2" integer,
	"reference_currency" text DEFAULT 'USD',
	"reference_moq" integer,
	"reference_incoterm" text,
	"reference_port" text,
	"reference_spec_version" integer,
	"reference_valid_until" date,
	"published_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "app"."request_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"line_ref" text NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"qty_first" integer,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"reorder_interval" text,
	"volume_12m" integer,
	"customisation" text,
	"materials" text,
	"client_sku" text,
	"client_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links_meta" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"milestone" text DEFAULT 'received' NOT NULL,
	"exception" text,
	"exception_reason" text,
	"spec_version" integer,
	"cost_model" jsonb,
	"uplift_pct" real,
	"target_price_minor_e2" integer,
	"target_confirmed_by" text,
	"target_confirmed_at" timestamp with time zone,
	"assigned_agent_id" text,
	"selected_participation_id" uuid,
	"backup_participation_id" uuid,
	"artwork_required" boolean DEFAULT false NOT NULL,
	"sample_required" boolean DEFAULT true NOT NULL,
	"is_repeat" boolean DEFAULT false NOT NULL,
	"from_catalog" boolean DEFAULT false NOT NULL,
	"from_range_id" uuid,
	"cancel_reason" text,
	"stale_since" timestamp with time zone,
	"last_state_change_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "request_lines_line_ref_unique" UNIQUE("line_ref")
);
--> statement-breakpoint
CREATE TABLE "app"."requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text DEFAULT 'portal' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"client_ref" text,
	"note" text,
	"submitted_at" timestamp with time zone,
	"target_delivery" date,
	"destination" text,
	"incoterm_wanted" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "requests_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "app"."rfqs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"request_line_id" uuid,
	"org_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"file_id" uuid,
	"sent_at" timestamp with time zone,
	"recipients_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"org_id" uuid NOT NULL,
	"request_line_id" uuid,
	"order_id" uuid,
	"participation_id" uuid,
	"status" text DEFAULT 'ordered' NOT NULL,
	"cost_minor" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"paid_by" text,
	"courier" text,
	"tracking" text,
	"ordered_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"reject_reason" text,
	"deviations_vs_spec" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "samples_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "app"."sequences" (
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sequences_name_year_pk" PRIMARY KEY("name","year")
);
--> statement-breakpoint
CREATE TABLE "app"."shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"forwarder" text,
	"forwarder_party" text,
	"forwarder_contact" text,
	"booking_ref" text,
	"factory_pickup_address" text,
	"mode" text,
	"container_or_awb" text,
	"bl_document_id" uuid,
	"packing_list_document_id" uuid,
	"cargo_ready" date,
	"exworks_shipped_at" timestamp with time zone,
	"etd" date,
	"eta_port" date,
	"port_of_discharge" text,
	"arrived_port_at" timestamp with time zone,
	"customs_status" text DEFAULT 'not_started' NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"password_set_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "supplier"."purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"factory_total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"terms" text,
	"exworks_eta" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"document_id" uuid,
	"issued_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "purchase_orders_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "supplier"."quote_price_breaks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"min_qty" integer NOT NULL,
	"unit_price_minor_e2" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier"."quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participation_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"pack_qty" integer,
	"incoterm" text,
	"incoterm_uncertain" boolean DEFAULT false NOT NULL,
	"port" text,
	"moq" integer,
	"lead_days" integer,
	"lead_days_max" integer,
	"valid_until" date,
	"payment_terms" text,
	"deviations" text,
	"unit_weight_g" real,
	"carton" text,
	"source_document_id" uuid,
	"normalised_usd_minor_e2" integer,
	"fx_rate" real,
	"fx_date" date,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier"."supplier_catalogues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"document_id" uuid,
	"received_at" timestamp with time zone,
	"valid_until" date,
	"currency" text DEFAULT 'USD',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier"."supplier_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" text,
	"channel" text NOT NULL,
	"handle" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "supplier"."supplier_participations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_line_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'contacted' NOT NULL,
	"reason" text,
	"notes" text,
	"first_contact_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "supplier"."supplier_performance" (
	"supplier_id" uuid PRIMARY KEY NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"on_time_rate" real,
	"defect_rate" real,
	"quote_accuracy" real,
	"last_order_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier"."supplier_price_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"document_id" uuid,
	"received_at" timestamp with time zone,
	"valid_until" date,
	"currency" text DEFAULT 'USD',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier"."suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"legal_name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"cn_name" text,
	"type_verdict" text DEFAULT 'unchecked' NOT NULL,
	"verdict_source" text,
	"verdict_checked_at" timestamp with time zone,
	"grade" text,
	"uscc" text,
	"registered_at" date,
	"capital" text,
	"city" text,
	"province" text,
	"country" text DEFAULT 'CN' NOT NULL,
	"ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website" text,
	"notes" text,
	"disclosed_to_org_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "suppliers_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."artworks" ADD CONSTRAINT "artworks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."artworks" ADD CONSTRAINT "artworks_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "app"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."comments" ADD CONSTRAINT "comments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "app"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."factory_range_items" ADD CONSTRAINT "factory_range_items_range_id_factory_ranges_id_fk" FOREIGN KEY ("range_id") REFERENCES "app"."factory_ranges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."factory_range_items" ADD CONSTRAINT "factory_range_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."factory_ranges" ADD CONSTRAINT "factory_ranges_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspections" ADD CONSTRAINT "inspections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspections" ADD CONSTRAINT "inspections_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offer_options" ADD CONSTRAINT "offer_options_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "app"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offers" ADD CONSTRAINT "offers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offers" ADD CONSTRAINT "offers_request_line_id_request_lines_id_fk" FOREIGN KEY ("request_line_id") REFERENCES "app"."request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_lines" ADD CONSTRAINT "order_lines_request_line_id_request_lines_id_fk" FOREIGN KEY ("request_line_id") REFERENCES "app"."request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "app"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_request_line_id_request_lines_id_fk" FOREIGN KEY ("request_line_id") REFERENCES "app"."request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_specs" ADD CONSTRAINT "product_specs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_lines" ADD CONSTRAINT "request_lines_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_lines" ADD CONSTRAINT "request_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_lines" ADD CONSTRAINT "request_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD CONSTRAINT "requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rfqs" ADD CONSTRAINT "rfqs_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rfqs" ADD CONSTRAINT "rfqs_request_line_id_request_lines_id_fk" FOREIGN KEY ("request_line_id") REFERENCES "app"."request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rfqs" ADD CONSTRAINT "rfqs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."samples" ADD CONSTRAINT "samples_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."samples" ADD CONSTRAINT "samples_request_line_id_request_lines_id_fk" FOREIGN KEY ("request_line_id") REFERENCES "app"."request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipments" ADD CONSTRAINT "shipments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."purchase_orders" ADD CONSTRAINT "purchase_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."quote_price_breaks" ADD CONSTRAINT "quote_price_breaks_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "supplier"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."quotes" ADD CONSTRAINT "quotes_participation_id_supplier_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "supplier"."supplier_participations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."supplier_catalogues" ADD CONSTRAINT "supplier_catalogues_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."supplier_participations" ADD CONSTRAINT "supplier_participations_request_line_id_request_lines_id_fk" FOREIGN KEY ("request_line_id") REFERENCES "app"."request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."supplier_participations" ADD CONSTRAINT "supplier_participations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."supplier_participations" ADD CONSTRAINT "supplier_participations_contact_id_supplier_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "supplier"."supplier_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."supplier_performance" ADD CONSTRAINT "supplier_performance_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier"."supplier_price_lists" ADD CONSTRAINT "supplier_price_lists_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_entity_idx" ON "app"."activity_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_org_idx" ON "app"."activity_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "comments_entity_idx" ON "app"."comments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "documents_entity_idx" ON "app"."documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_uidx" ON "app"."fx_rates" USING btree ("date","base","quote");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "app"."notification_outbox" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "offers_line_idx" ON "app"."offers" USING btree ("request_line_id");--> statement-breakpoint
CREATE INDEX "orders_org_idx" ON "app"."orders" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_specs_product_version_uidx" ON "app"."product_specs" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "request_lines_org_idx" ON "app"."request_lines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "request_lines_request_idx" ON "app"."request_lines" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_lines_state_idx" ON "app"."request_lines" USING btree ("state");--> statement-breakpoint
CREATE INDEX "requests_org_idx" ON "app"."requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "quotes_participation_idx" ON "supplier"."quotes" USING btree ("participation_id");--> statement-breakpoint
CREATE INDEX "participations_line_idx" ON "supplier"."supplier_participations" USING btree ("request_line_id");--> statement-breakpoint
CREATE INDEX "participations_supplier_idx" ON "supplier"."supplier_participations" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "suppliers_normalised_idx" ON "supplier"."suppliers" USING btree ("normalised_name");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
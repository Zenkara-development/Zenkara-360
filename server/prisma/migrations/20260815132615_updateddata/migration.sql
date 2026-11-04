-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PROBATION', 'ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('ONSITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('HEAD_OFFICE', 'BRANCH', 'PLANT', 'WAREHOUSE', 'CLIENT_SITE', 'REMOTE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('MANUAL', 'WORKFLOW', 'AI', 'ONBOARDING', 'OFFBOARDING', 'APPROVAL', 'RECURRENCE', 'SERVICE_REQUEST');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('SEQUENTIAL', 'PARALLEL', 'ANY_ONE', 'UNANIMOUS');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('USER', 'ROLE', 'MANAGER', 'SKIP_LEVEL_MANAGER', 'DEPARTMENT_HEAD', 'TEAM_LEAD', 'DYNAMIC_FIELD');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'DELEGATED');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('NONE', 'OWN', 'TEAM', 'DEPARTMENT', 'ALL');

-- CreateEnum
CREATE TYPE "FieldAccess" AS ENUM ('HIDDEN', 'MASKED', 'READ', 'WRITE');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('KB_ARTICLE', 'TICKET', 'HR_POLICY', 'DEAL', 'ACCOUNT', 'UPLOAD', 'WEB', 'CUSTOM');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('PUBLIC', 'INTERNAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('SUCCESS', 'ERROR', 'CACHED', 'BLOCKED', 'BUDGET_EXCEEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'EMPLOYEE';
ALTER TYPE "EntityType" ADD VALUE 'TASK';
ALTER TYPE "EntityType" ADD VALUE 'APPROVAL_REQUEST';
ALTER TYPE "EntityType" ADD VALUE 'DEPARTMENT';
ALTER TYPE "EntityType" ADD VALUE 'INVOICE';

-- AlterTable
ALTER TABLE "office_locations" ADD COLUMN     "location_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role_id" TEXT;

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "parent_id" TEXT,
    "head_id" TEXT,
    "cost_center" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "LocationType" NOT NULL DEFAULT 'BRANCH',
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "timezone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "employee_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "display_name" TEXT NOT NULL,
    "work_email" TEXT,
    "personal_email" TEXT,
    "phone" TEXT,
    "alternate_phone" TEXT,
    "date_of_birth" DATE,
    "gender" TEXT,
    "marital_status" TEXT,
    "blood_group" TEXT,
    "photo_url" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "designation" TEXT,
    "department_id" TEXT,
    "location_id" TEXT,
    "manager_id" TEXT,
    "dotted_line_manager_id" TEXT,
    "cost_center" TEXT,
    "work_mode" "WorkMode" NOT NULL DEFAULT 'ONSITE',
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "joining_date" DATE NOT NULL,
    "probation_end_date" DATE,
    "confirmation_date" DATE,
    "resignation_date" DATE,
    "last_working_date" DATE,
    "exit_type" TEXT,
    "exit_reason" TEXT,
    "is_rehire_eligible" BOOLEAN,
    "bank_account_name" TEXT,
    "bank_account_number" TEXT,
    "bank_name" TEXT,
    "bank_ifsc" TEXT,
    "tax_id" TEXT,
    "national_id" TEXT,
    "social_security_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_contacts" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "is_emergency" BOOLEAN NOT NULL DEFAULT true,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_education" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "field_of_study" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "grade" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_experience" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_skills" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 3,
    "years_experience" DECIMAL(4,1),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_certifications" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "credential_id" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "storage_key" TEXT NOT NULL,
    "issued_on" DATE,
    "expires_on" DATE,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "uploaded_by" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams_internal" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "department_id" TEXT,
    "lead_id" TEXT,
    "type" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_internal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "start_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "assignee_user_id" TEXT,
    "assignee_employee_id" TEXT,
    "created_by" TEXT NOT NULL,
    "entity_type" "EntityType",
    "entity_id" TEXT,
    "parent_task_id" TEXT,
    "checklist" JSONB,
    "recurrence_rule" TEXT,
    "recurrence_parent_id" TEXT,
    "recurrence_until" TIMESTAMP(3),
    "estimate_minutes" INTEGER,
    "spent_minutes" INTEGER,
    "source" "TaskSource" NOT NULL DEFAULT 'MANUAL',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "depends_on_task_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FINISH_TO_START',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policies" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entity_type" TEXT NOT NULL,
    "mode" "ApprovalMode" NOT NULL DEFAULT 'SEQUENTIAL',
    "conditions" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "expiry_hours" INTEGER,
    "escalate_after_hours" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policy_steps" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "approver_type" "ApproverType" NOT NULL,
    "approver_user_id" TEXT,
    "approver_role_key" TEXT,
    "approver_field" TEXT,
    "min_approvals" INTEGER NOT NULL DEFAULT 1,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB,

    CONSTRAINT "approval_policy_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2),
    "currency" TEXT,
    "requested_by" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "facts" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_request_steps" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "min_approvals" INTEGER NOT NULL DEFAULT 1,
    "approver_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "decided_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_request_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "delegated_from_user_id" TEXT,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "acted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "legacy_role" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL DEFAULT 'ALL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_permissions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "role_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "access" "FieldAccess" NOT NULL DEFAULT 'READ',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "source_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "external_id" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "mime_type" TEXT,
    "content_hash" TEXT NOT NULL,
    "language" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'INTERNAL',
    "allowed_role_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_department_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_permission" TEXT,
    "token_count" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "indexed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embedding_model" TEXT,
    "embedding_dim" INTEGER,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'INTERNAL',
    "heading" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT,
    "api_key_encrypted" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_configs" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "task_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "context_window" INTEGER,
    "max_output_tokens" INTEGER,
    "input_cost_per_1k" DECIMAL(10,6),
    "output_cost_per_1k" DECIMAL(10,6),
    "supports_json" BOOLEAN NOT NULL DEFAULT true,
    "supports_tools" BOOLEAN NOT NULL DEFAULT false,
    "embedding_dim" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_interaction_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "feature" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "status" "AiCallStatus" NOT NULL DEFAULT 'SUCCESS',
    "error_message" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "action_name" TEXT,
    "action_executed" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "confidence" DECIMAL(5,4),
    "citations" JSONB,
    "prompt_preview" TEXT,
    "response_preview" TEXT,
    "redacted_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feedback" TEXT,
    "feedback_reason" TEXT,
    "feedback_by" TEXT,
    "feedback_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interaction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budgets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'MONTHLY',
    "limit_usd" DECIMAL(12,2) NOT NULL,
    "alert_threshold_percent" INTEGER NOT NULL DEFAULT 80,
    "hard_stop" BOOLEAN NOT NULL DEFAULT false,
    "current_spend_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "alert_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_org_id_idx" ON "departments"("org_id");

-- CreateIndex
CREATE INDEX "departments_org_id_parent_id_idx" ON "departments"("org_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_org_id_name_key" ON "departments"("org_id", "name");

-- CreateIndex
CREATE INDEX "locations_org_id_idx" ON "locations"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_org_id_name_key" ON "locations"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_org_id_idx" ON "employees"("org_id");

-- CreateIndex
CREATE INDEX "employees_org_id_department_id_idx" ON "employees"("org_id", "department_id");

-- CreateIndex
CREATE INDEX "employees_org_id_manager_id_idx" ON "employees"("org_id", "manager_id");

-- CreateIndex
CREATE INDEX "employees_org_id_employment_status_idx" ON "employees"("org_id", "employment_status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_org_id_employee_code_key" ON "employees"("org_id", "employee_code");

-- CreateIndex
CREATE INDEX "employee_contacts_employee_id_idx" ON "employee_contacts"("employee_id");

-- CreateIndex
CREATE INDEX "employee_education_employee_id_idx" ON "employee_education"("employee_id");

-- CreateIndex
CREATE INDEX "employee_experience_employee_id_idx" ON "employee_experience"("employee_id");

-- CreateIndex
CREATE INDEX "skills_org_id_idx" ON "skills"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_org_id_name_key" ON "skills"("org_id", "name");

-- CreateIndex
CREATE INDEX "employee_skills_skill_id_idx" ON "employee_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_skills_employee_id_skill_id_key" ON "employee_skills"("employee_id", "skill_id");

-- CreateIndex
CREATE INDEX "employee_certifications_employee_id_idx" ON "employee_certifications"("employee_id");

-- CreateIndex
CREATE INDEX "employee_certifications_expires_on_idx" ON "employee_certifications"("expires_on");

-- CreateIndex
CREATE INDEX "employee_documents_org_id_employee_id_idx" ON "employee_documents"("org_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_documents_org_id_expires_on_idx" ON "employee_documents"("org_id", "expires_on");

-- CreateIndex
CREATE INDEX "teams_internal_org_id_idx" ON "teams_internal"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_internal_org_id_name_key" ON "teams_internal"("org_id", "name");

-- CreateIndex
CREATE INDEX "team_members_employee_id_idx" ON "team_members"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_employee_id_key" ON "team_members"("team_id", "employee_id");

-- CreateIndex
CREATE INDEX "tasks_org_id_status_idx" ON "tasks"("org_id", "status");

-- CreateIndex
CREATE INDEX "tasks_org_id_assignee_user_id_status_idx" ON "tasks"("org_id", "assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "tasks_org_id_entity_type_entity_id_idx" ON "tasks"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "tasks_org_id_due_at_idx" ON "tasks"("org_id", "due_at");

-- CreateIndex
CREATE INDEX "task_dependencies_depends_on_task_id_idx" ON "task_dependencies"("depends_on_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_task_id_depends_on_task_id_key" ON "task_dependencies"("task_id", "depends_on_task_id");

-- CreateIndex
CREATE INDEX "approval_policies_org_id_entity_type_is_active_idx" ON "approval_policies"("org_id", "entity_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "approval_policy_steps_policy_id_order_key" ON "approval_policy_steps"("policy_id", "order");

-- CreateIndex
CREATE INDEX "approval_requests_org_id_status_idx" ON "approval_requests"("org_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_org_id_entity_type_entity_id_idx" ON "approval_requests"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "approval_requests_org_id_requested_by_idx" ON "approval_requests"("org_id", "requested_by");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_steps_request_id_order_key" ON "approval_request_steps"("request_id", "order");

-- CreateIndex
CREATE INDEX "approval_actions_step_id_idx" ON "approval_actions"("step_id");

-- CreateIndex
CREATE INDEX "approval_actions_approver_id_idx" ON "approval_actions"("approver_id");

-- CreateIndex
CREATE INDEX "approval_delegations_org_id_from_user_id_is_active_idx" ON "approval_delegations"("org_id", "from_user_id", "is_active");

-- CreateIndex
CREATE INDEX "roles_org_id_idx" ON "roles"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_org_id_key_key" ON "roles"("org_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_resource_idx" ON "permissions"("module", "resource");

-- CreateIndex
CREATE INDEX "role_permissions_permission_key_idx" ON "role_permissions"("permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_key_key" ON "role_permissions"("role_id", "permission_key");

-- CreateIndex
CREATE INDEX "field_permissions_role_id_resource_idx" ON "field_permissions"("role_id", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "field_permissions_role_id_resource_field_key" ON "field_permissions"("role_id", "resource", "field");

-- CreateIndex
CREATE INDEX "knowledge_sources_org_id_type_idx" ON "knowledge_sources"("org_id", "type");

-- CreateIndex
CREATE INDEX "knowledge_documents_org_id_is_active_idx" ON "knowledge_documents"("org_id", "is_active");

-- CreateIndex
CREATE INDEX "knowledge_documents_org_id_content_hash_idx" ON "knowledge_documents"("org_id", "content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_org_id_entity_type_entity_id_key" ON "knowledge_documents"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_org_id_visibility_idx" ON "knowledge_chunks"("org_id", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_chunk_index_key" ON "knowledge_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_org_id_key_key" ON "ai_providers"("org_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_configs_provider_id_model_name_key" ON "ai_model_configs"("provider_id", "model_name");

-- CreateIndex
CREATE INDEX "ai_interaction_logs_org_id_created_at_idx" ON "ai_interaction_logs"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_interaction_logs_org_id_feature_idx" ON "ai_interaction_logs"("org_id", "feature");

-- CreateIndex
CREATE INDEX "ai_interaction_logs_org_id_status_idx" ON "ai_interaction_logs"("org_id", "status");

-- CreateIndex
CREATE INDEX "ai_interaction_logs_org_id_user_id_idx" ON "ai_interaction_logs"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "ai_budgets_org_id_idx" ON "ai_budgets"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_budgets_org_id_period_period_start_key" ON "ai_budgets"("org_id", "period", "period_start");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_locations" ADD CONSTRAINT "office_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_id_fkey" FOREIGN KEY ("head_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_dotted_line_manager_id_fkey" FOREIGN KEY ("dotted_line_manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_contacts" ADD CONSTRAINT "employee_contacts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_education" ADD CONSTRAINT "employee_education_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_experience" ADD CONSTRAINT "employee_experience_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams_internal" ADD CONSTRAINT "teams_internal_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams_internal" ADD CONSTRAINT "teams_internal_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams_internal" ADD CONSTRAINT "teams_internal_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams_internal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_employee_id_fkey" FOREIGN KEY ("assignee_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policy_steps" ADD CONSTRAINT "approval_policy_steps_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request_steps" ADD CONSTRAINT "approval_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "approval_request_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_permissions" ADD CONSTRAINT "field_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_configs" ADD CONSTRAINT "ai_model_configs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_budgets" ADD CONSTRAINT "ai_budgets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

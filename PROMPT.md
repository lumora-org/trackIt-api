# K.B.Y GLOBAL INVESTMENT — Backend Implementation Prompt

You are the lead backend engineer responsible for building the production backend API for **K.B.Y GLOBAL INVESTMENT**, a multi-branch fueling-station management platform.

The backend codebase is located in this repository.

---

# 1. STOP AND READ THE DOCUMENTATION FIRST

Before writing application code, you MUST inspect the entire:

```text
docs/
```

directory.

The documentation is the primary source of truth.

You must understand:

- Product requirements
- Architecture
- Database design
- API specification
- Authentication
- Authorization
- Fuel management
- Supply chain
- Fuel orders
- Deliveries
- Receiving
- Inventory
- Sales
- Revenue
- Daily reports
- Notifications
- Audit logging

Do not begin implementation by guessing the domain.

Do not create entities simply because they appear convenient.

Do not add major features that are not documented.

---

# 2. Product

Build the backend for:

**K.B.Y GLOBAL INVESTMENT**

The platform manages multiple fueling-station branches.

Core roles:

```text
SUPER_ADMIN
ADMIN
MANAGER
```

The backend must enforce all authorization rules.

The frontend is never trusted.

---

# 3. Required Technology

The backend should use:

```text
Node.js
TypeScript
NestJS
PostgreSQL 16+
TypeORM
JWT
Refresh Tokens
Swagger/OpenAPI
```

Use the existing project stack if already configured.

Do not replace an existing technology without a clear architectural reason.

---

# 4. Architecture

Use a modular NestJS architecture.

Recommended:

```text
src/
├── main.ts
├── app.module.ts
├── config/
├── common/
├── database/
├── auth/
├── users/
├── businesses/
├── branches/
├── fuel-types/
├── fuel-prices/
├── suppliers/
├── tankers/
├── fuel-orders/
├── deliveries/
├── inventory/
├── sales/
├── daily-reports/
├── notifications/
├── dashboard/
├── reports/
└── audit-logs/
```

Each business module should generally follow:

```text
module
controller
service
repository
entities
dto
interfaces
constants
```

Controllers should remain thin.

Business logic belongs in services/domain logic.

---

# 5. API Prefix

Use:

```text
/api/v1
```

Example:

```text
GET /api/v1/sales
```

Health endpoint:

```text
GET /health
```

Swagger should be available in development.

---

# 6. Database

Use PostgreSQL.

Required principles:

```text
UUID primary keys
TIMESTAMPTZ timestamps
UTC storage
NUMERIC(18,2) monetary values
NUMERIC(18,3) fuel quantities
Foreign keys
Business-scoped uniqueness
Indexes
Database constraints
Migrations
```

Production configuration:

```typescript
synchronize: false
```

Never depend on TypeORM `synchronize` for production schema management.

---

# 7. Database Tables

The documented MVP schema contains:

```text
users
refresh_tokens
password_reset_tokens

businesses
branches

fuel_types
fuel_prices

suppliers
tankers

fuel_orders
fuel_order_items

deliveries
delivery_items

inventory_transactions

sales

daily_reports

notifications
audit_logs
```

Do not introduce unnecessary tables.

---

# 8. Roles

Use:

```text
SUPER_ADMIN
ADMIN
MANAGER
```

Role hierarchy must not be interpreted as unrestricted access.

Authorization also depends on:

```text
business
branch
resource ownership
operation
```

---

# 9. Authorization Model

Every protected request must pass:

```text
Authentication
      ↓
Role authorization
      ↓
Business ownership
      ↓
Branch ownership
      ↓
Operation-specific authorization
```

Example:

A manager authenticated to:

```text
KBY-IKEJA
```

must not access:

```text
KBY-YABA
```

even if the manager manually changes:

```text
branchId
```

in the URL or request body.

---

# 10. Never Trust Client Context

Never trust client-provided:

```text
businessId
branchId
role
userId
unitPrice
totalAmount
inventoryBalance
```

The backend derives authoritative values.

For managers:

```text
businessId = authenticatedUser.businessId
branchId = authenticatedUser.branchId
```

For administrators:

Business context may be selected only through authorized operations.

---

# 11. Users

User rules:

```text
SUPER_ADMIN
business_id = NULL
branch_id = NULL

ADMIN
business_id = required
branch_id = NULL

MANAGER
business_id = required
branch_id = required
```

Email uniqueness should be case-insensitive.

Prefer:

```sql
UNIQUE (LOWER(email))
```

or an equivalent PostgreSQL strategy.

Passwords must be hashed using a strong password hashing algorithm such as Argon2.

Never store plaintext passwords.

---

# 12. Authentication

Implement:

```text
Login
Logout
Refresh token
Forgot password
Reset password
```

Access tokens should be short-lived.

Refresh tokens should:

- Be stored hashed
- Be revocable
- Have expiration
- Support rotation where appropriate

Never store raw refresh tokens in the database.

---

# 13. Validation

Use:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```

DTOs must validate all externally supplied data.

Do not rely only on frontend validation.

---

# 14. Security

Use:

```text
Helmet
CORS
Rate limiting
DTO validation
Secure password hashing
JWT validation
Refresh token validation
Input sanitization where appropriate
```

Never log:

```text
password
JWT
refresh token
password reset token
client secret
database password
```

---

# 15. Fuel Types

Fuel types are business-scoped.

Example:

```text
PMS
AGO
DPK
```

A fuel type has:

```text
id
business_id
name
code
description
status
created_at
updated_at
```

Constraint:

```sql
UNIQUE (business_id, code)
```

Inactive fuel types cannot be used for new sales/orders unless explicitly allowed by the documented workflow.

Historical references must remain valid.

---

# 16. Fuel Prices

Fuel prices are historical time intervals.

Fields:

```text
fuel_type_id
price_per_litre
effective_from
effective_to
created_by
```

Example:

```text
Oct 01 → ₦1,500
Oct 10 → ₦1,550
Oct 18 → ₦1,600
```

Do not overwrite historical prices.

---

# 17. Price Interval Rule

For the same:

```text
business
fuel_type
```

price intervals must not overlap.

Preferred PostgreSQL strategy:

```sql
EXCLUDE USING gist (
  business_id WITH =,
  fuel_type_id WITH =,
  tstzrange(
    effective_from,
    effective_to,
    '[)'
  ) WITH &&
)
```

Use a transaction when changing prices.

---

# 18. Price Resolution

Implement a reusable domain/service function:

```typescript
getApplicablePrice(
  businessId: string,
  fuelTypeId: string,
  at: Date,
);
```

It should return the price effective at the requested timestamp.

Sales must snapshot the resolved price into:

```text
sales.unit_price
```

---

# 19. Suppliers

Suppliers are business-scoped.

Fields:

```text
id
business_id
name
code
contact_person
phone
email
address
status
created_at
updated_at
deleted_at
```

Use soft deletion.

Historical orders must continue to reference suppliers.

---

# 20. Tankers

Tankers are business-scoped.

Fields:

```text
id
business_id
registration_number
tanker_code
capacity_litres
driver_name
driver_phone
status
created_at
updated_at
deleted_at
```

Constraints:

```text
capacity_litres > 0
unique business + registration_number
```

A common tanker capacity may be:

```text
45,000 L
```

---

# 21. Fuel Orders

Fuel orders represent procurement commitments.

They do NOT change inventory.

Entity:

```text
fuel_orders
```

Fields:

```text
id
business_id
order_number
supplier_id
destination_branch_id
status
ordered_at
expected_delivery_at
notes
created_by
created_at
updated_at
cancelled_at
```

Items:

```text
fuel_order_items
```

with:

```text
fuel_order_id
fuel_type_id
expected_quantity_litres
unit_cost
created_at
```

---

# 22. Fuel Order Lifecycle

Implement:

```text
DRAFT
↓
SUBMITTED
↓
CONFIRMED
↓
IN_TRANSIT
↓
PARTIALLY_DELIVERED
↓
DELIVERED
```

Cancellation:

```text
DRAFT
SUBMITTED
CONFIRMED
    ↓
CANCELLED
```

Enforce legal state transitions in the backend.

Do not allow arbitrary status changes through:

```text
PATCH /fuel-orders/:id
```

---

# 23. Multiple Deliveries

One fuel order may have multiple deliveries.

Example:

```text
Order:
60,000 L

Delivery 1:
45,000 L

Delivery 2:
15,000 L
```

Therefore:

```text
fuel_order
    ↓
many deliveries
```

Each delivery can have its own tanker.

---

# 24. Deliveries

Delivery entity:

```text
deliveries
```

Fields:

```text
id
business_id
fuel_order_id
tanker_id
destination_branch_id
delivery_number
delivery_status
delivered_at
received_by
notes
created_at
updated_at
```

Delivery items:

```text
delivery_items
```

Fields:

```text
delivery_id
fuel_type_id
expected_quantity_litres
actual_quantity_litres
difference_litres
discrepancy_reason
created_at
```

---

# 25. Delivery Rules

The delivery destination must match the fuel order destination.

The delivery business must match:

```text
fuel_order.business_id
tanker.business_id
destination_branch.business_id
```

Actual received quantity is authoritative for inventory.

Expected quantity does not change inventory.

---

# 26. Delivery Receiving

Receiving is a critical database transaction.

Use:

```typescript
dataSource.transaction(async (manager) => {
  // all related operations
});
```

Recommended flow:

```text
Lock delivery
Validate status
Validate branch
Validate order
Validate quantities
Calculate variance
Mark delivery received
Create inventory transactions
Update order status
Create audit record
Create notification
Commit
```

---

# 27. Duplicate Delivery Protection

A delivery must never create inventory twice.

Protect with:

```text
delivery status
+
database uniqueness
+
transactional logic
```

Inventory references should identify:

```text
reference_type = DELIVERY
reference_id = delivery.id
```

Consider a unique constraint for the reference relationship.

The receive operation should be idempotent where practical.

---

# 28. Discrepancies

Example:

```text
Expected:
45,000 L

Actual:
44,850 L

Variance:
-150 L
```

Store:

```text
difference_litres = -150
```

Any discrepancy must be visible to administrators.

A material discrepancy may result in:

```text
DISPUTED
```

The threshold should be configurable later.

---

# 29. Inventory

Inventory is ledger-driven.

Table:

```text
inventory_transactions
```

Do not introduce an authoritative mutable:

```text
current_stock
```

field.

---

# 30. Inventory Transaction Types

```text
OPENING_BALANCE
DELIVERY
SALE
ADJUSTMENT
TRANSFER_IN
TRANSFER_OUT
CORRECTION
```

Signed quantity:

```text
DELIVERY       +45,000
SALE            -8,500
ADJUSTMENT       +100
TRANSFER_IN     +2,000
TRANSFER_OUT    -2,000
```

---

# 31. Inventory Source of Truth

Current stock:

```sql
SELECT COALESCE(SUM(quantity_litres), 0)
FROM inventory_transactions
WHERE branch_id = :branchId
  AND fuel_type_id = :fuelTypeId;
```

`balance_after` may be stored as a performance snapshot but is not the source of truth.

---

# 32. Inventory Append-Only Rule

Do not edit historical inventory transactions.

Incorrect:

```text
UPDATE inventory_transactions
```

for a historical correction.

Instead:

```text
Original transaction
       ↓
CORRECTION transaction
```

All corrections require:

```text
reason
user
timestamp
audit
```

---

# 33. Negative Inventory

The backend must prevent sales that cause negative stock.

Use transaction/locking.

Critical sale flow:

```text
BEGIN
↓
Lock inventory state
↓
Calculate available stock
↓
Verify requested quantity
↓
Create sale
↓
Create SALE inventory transaction
↓
COMMIT
```

---

# 34. Sales

Sales table:

```text
sales
```

Fields:

```text
id
business_id
branch_id
fuel_type_id
sale_number
litres_sold
unit_price
total_amount
sold_at
recorded_by
created_at
updated_at
voided_at
void_reason
```

---

# 35. Sale Calculation

Never trust:

```text
unitPrice
totalAmount
```

from the frontend.

Backend:

```text
unit_price =
applicable fuel price

total_amount =
litres_sold × unit_price
```

---

# 36. Sale Transaction

A successful sale must create:

```text
SALE
quantity_litres = -litres_sold
```

in the same database transaction as the sale record.

---

# 37. Sale Voiding

Do not delete sales.

When voiding:

```text
voided_at
void_reason
```

must be recorded.

Then restore inventory through:

```text
CORRECTION
+original litres
```

Revenue calculations must exclude:

```text
voided_at IS NOT NULL
```

---

# 38. Daily Reports

Daily reports are summaries.

Table:

```text
daily_reports
```

One report per:

```text
branch + report_date
```

Use:

```sql
UNIQUE (branch_id, report_date)
```

---

# 39. Daily Report Calculation

Opening:

```text
inventory balance before report date
```

Received:

```text
actual received delivery quantities
```

Sold:

```text
non-voided sales
```

Revenue:

```text
non-voided sale amounts
```

Closing:

```text
inventory ledger balance
```

Never trust manually submitted totals.

---

# 40. Daily Report Workflow

```text
DRAFT
↓
SUBMITTED
↓
UNDER_REVIEW
↓
APPROVED
```

Rejection:

```text
UNDER_REVIEW
↓
REJECTED
↓
SUBMITTED
```

Rejection must contain a reason.

---

# 41. Notifications

Persist notifications in:

```text
notifications
```

Notification types:

```text
REPORT_SUBMITTED
REPORT_APPROVED
REPORT_REJECTED
DELIVERY_RECEIVED
DELIVERY_DISCREPANCY
LOW_INVENTORY
SYSTEM
```

Notifications should normally be generated from domain events.

Example:

```text
SaleCreatedEvent
DeliveryReceivedEvent
DailyReportSubmittedEvent
DailyReportApprovedEvent
DailyReportRejectedEvent
```

---

# 42. Audit Logging

Critical business operations must be audited.

Audit should capture:

```text
user
role
business
branch
action
resource
resource_id
timestamp
IP
user-agent
before
after
details
```

At minimum audit:

```text
Authentication events
User changes
Fuel price changes
Fuel order status changes
Delivery receiving
Delivery disputes
Inventory adjustments
Inventory corrections
Sales
Sale voids
Daily report submissions
Daily report approvals
Daily report rejections
```

---

# 43. API Design

All APIs should use:

```text
/api/v1
```

Use conventional REST semantics.

Examples:

```text
GET    /fuel-types
POST   /fuel-types
PATCH  /fuel-types/:id

GET    /fuel-prices/current
POST   /fuel-prices

GET    /suppliers
POST   /suppliers

GET    /fuel-orders
POST   /fuel-orders
POST   /fuel-orders/:id/submit
POST   /fuel-orders/:id/confirm

GET    /deliveries
POST   /deliveries
POST   /deliveries/:id/receive

GET    /inventory
GET    /inventory/transactions

GET    /sales
POST   /sales
POST   /sales/:id/void

GET    /daily-reports
POST   /daily-reports
POST   /daily-reports/:id/submit
POST   /daily-reports/:id/approve
POST   /daily-reports/:id/reject
```

Follow the detailed API documentation in `docs/`.

---

# 44. DTO Rules

Use DTOs for all external requests.

Examples:

```text
CreateSaleDto
CreateFuelOrderDto
CreateDeliveryDto
ReceiveDeliveryDto
CreateFuelPriceDto
SubmitDailyReportDto
RejectDailyReportDto
```

Use:

```text
class-validator
class-transformer
```

where appropriate.

Do not expose entity objects directly as request contracts.

---

# 45. Response DTOs

Do not blindly return TypeORM entities.

Create response DTOs where appropriate.

Avoid exposing:

```text
password_hash
refresh token hashes
internal secrets
sensitive audit information
```

---

# 46. Error Handling

Use consistent HTTP semantics.

Examples:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
500 Internal Server Error
```

Business conflicts should use `409` where appropriate.

Examples:

```text
Fuel price interval overlaps existing price
Fuel order cannot transition to requested status
Delivery already received
Insufficient inventory
Daily report already exists
```

---

# 47. Database Transactions

Use transactions for operations affecting multiple authoritative records.

Mandatory examples:

```text
Create fuel order + items
Receive delivery + inventory
Create sale + inventory
Void sale + inventory correction
Approve/reject workflows where multiple records change
```

Never perform part of a critical business operation outside the transaction.

---

# 48. Concurrency

Use PostgreSQL transaction semantics and row locking where necessary.

Especially for:

```text
Inventory
Sales
Delivery receiving
Fuel pricing
Order status transitions
```

Avoid application-only locking.

The database must protect the integrity of the operation.

---

# 49. Idempotency

Important operations should support idempotency where retry duplication is possible.

Especially:

```text
Delivery receiving
Sales
External integrations
Notifications
```

An idempotency key can be stored and checked before creating duplicate business records.

---

# 50. Indexes

Implement documented indexes for:

```text
users
branches
fuel_prices
fuel_orders
deliveries
inventory_transactions
sales
daily_reports
audit_logs
```

Indexes should support:

```text
business filtering
branch filtering
date filtering
status filtering
resource lookup
```

Do not create indexes blindly; verify query patterns.

---

# 51. Soft Deletes

Soft delete master/reference data:

```text
users
businesses
branches
suppliers
tankers
fuel_types
```

Do not casually delete:

```text
sales
deliveries
inventory transactions
approved reports
```

Use business workflows such as:

```text
VOID
CANCEL
DISPUTE
CORRECTION
```

where appropriate.

---

# 52. Seed Data

Development seed data should include:

Business:

```text
K.B.Y GLOBAL INVESTMENT
```

Branches:

```text
KBY-IKEJA
KBY-YABA
KBY-LEKKI
```

Fuel types:

```text
PMS
AGO
DPK
```

Create appropriate demo:

```text
Admin
Managers
Suppliers
Tankers
Fuel prices
```

Seed data must never contain real production credentials.

---

# 53. Testing

Write tests for:

## Authentication

```text
Login
Invalid credentials
Refresh
Logout
Password reset
```

## Authorization

```text
Manager cannot access another branch
Manager cannot approve reports
Admin cannot access another business
```

## Fuel pricing

```text
Historical price resolution
Overlapping intervals rejected
Future price scheduling
```

## Orders

```text
Valid order
Invalid supplier
Invalid branch
Illegal status transition
Cancellation
```

## Deliveries

```text
Receive delivery
Short delivery
Duplicate receive
Wrong branch
Disputed delivery
```

## Inventory

```text
Delivery increases stock
Sale decreases stock
Negative stock rejected
Correction works
Concurrent sale protection
```

## Sales

```text
Price resolution
Revenue calculation
Oversell
Void sale
Inventory restoration
```

## Reports

```text
Correct daily calculation
Voided sale excluded
Duplicate report rejected
Approval
Rejection
Resubmission
```

---

# 54. API Documentation

Swagger must document:

```text
Authentication
Roles
Request DTOs
Response DTOs
Error responses
Pagination
Filtering
```

Use appropriate decorators:

```typescript
@ApiTags()
@ApiOperation()
@ApiResponse()
@ApiBearerAuth()
```

---

# 55. Logging

Use structured application logs.

Log:

```text
request ID
user ID
business ID
branch ID
operation
duration
result
```

Do not log:

```text
passwords
tokens
secrets
```

---

# 56. Environment Configuration

Use environment variables for:

```text
DATABASE_URL
JWT_SECRET
JWT_EXPIRES_IN
REFRESH_TOKEN_SECRET
REFRESH_TOKEN_EXPIRES_IN
PORT
CORS_ORIGIN
```

Never hardcode credentials.

Provide:

```text
.env.example
```

with placeholders.

---

# 57. Migration Strategy

Use TypeORM migrations.

Recommended process:

```text
Create migration
↓
Review generated SQL
↓
Run migration locally
↓
Run tests
↓
Commit migration
```

Never depend on:

```text
synchronize: true
```

for production.

---

# 58. Implementation Order

Implement in this order:

```text
1. Project foundation
2. Configuration
3. Database connection
4. Migrations
5. Common infrastructure
6. Authentication
7. Users
8. Businesses
9. Branches
10. Fuel types
11. Fuel prices
12. Suppliers
13. Tankers
14. Fuel orders
15. Deliveries
16. Inventory
17. Sales
18. Daily reports
19. Notifications
20. Dashboard/reporting queries
21. Audit logging
22. Tests
23. Swagger
24. Security hardening
```

Do not implement everything as one massive change.

---

# 59. Definition of Done

A backend feature is complete when:

- Documentation has been reviewed.
- Business rules are implemented.
- Authorization is enforced.
- DTO validation exists.
- Database constraints exist where appropriate.
- Transactions are used where required.
- Concurrency is considered.
- Audit requirements are implemented.
- Tests exist.
- Swagger is updated.
- No TypeScript errors remain.
- No lint errors remain.
- No sensitive information is logged.
- The feature respects multi-business and branch isolation.

---

# 60. First Task

Before writing implementation code:

1. Inspect the repository.
2. Inspect the entire `docs/` directory.
3. Inspect `package.json`.
4. Inspect existing NestJS modules.
5. Inspect environment configuration.
6. Inspect existing migrations.
7. Identify what has already been implemented.
8. Compare implementation against the documentation.
9. Identify missing functionality.
10. Produce an implementation plan.
11. Identify contradictions before coding.
12. Begin implementation incrementally.

Do not overwrite working code simply to match your preferred architecture.

Preserve useful existing implementation when it complies with the documentation.

---

# 61. Final Instruction

You are implementing a real production backend, not a prototype with disconnected CRUD endpoints.

The system must preserve:

```text
Business isolation
Branch isolation
Inventory integrity
Financial accuracy
Historical pricing
Auditability
Concurrency safety
Data consistency
```

The most important business chain is:

```text
Supplier
   ↓
Fuel Order
   ↓
Tanker
   ↓
Delivery
   ↓
Inventory
   ↓
Sale
   ↓
Revenue
   ↓
Daily Report
```

Every part of this chain must remain internally consistent.

Before implementing anything:

> **Read the entire `docs/` folder and understand the project.**

Then inspect the existing repository and implement the documented scope incrementally.
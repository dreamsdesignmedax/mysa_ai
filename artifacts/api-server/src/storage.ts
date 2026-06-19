import { db } from "./lib/db";
import { organizations } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

export class Storage {
  // ── Stripe data from stripe schema ──────────────────────────────────────────

  async getProduct(productId: string) {
    const result = await db.execute(sql`SELECT * FROM stripe.products WHERE id = ${productId}`);
    return result.rows[0] ?? null;
  }

  async listProducts(active = true) {
    const result = await db.execute(sql`SELECT * FROM stripe.products WHERE active = ${active} ORDER BY created DESC`);
    return result.rows;
  }

  async listProductsWithPrices(active = true) {
    const result = await db.execute(sql`
      WITH paginated_products AS (
        SELECT id, name, description, metadata, active, images
        FROM stripe.products WHERE active = ${active} ORDER BY created DESC
      )
      SELECT
        p.id as product_id, p.name as product_name, p.description as product_description,
        p.active as product_active, p.metadata as product_metadata, p.images as product_images,
        pr.id as price_id, pr.unit_amount, pr.currency, pr.recurring,
        pr.active as price_active, pr.metadata as price_metadata
      FROM paginated_products p
      LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
      ORDER BY p.created DESC, pr.unit_amount
    `);
    return result.rows;
  }

  async getPrice(priceId: string) {
    const result = await db.execute(sql`SELECT * FROM stripe.prices WHERE id = ${priceId}`);
    return result.rows[0] ?? null;
  }

  async getSubscription(subscriptionId: string) {
    const result = await db.execute(sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId}`);
    return result.rows[0] ?? null;
  }

  async getCustomer(customerId: string) {
    const result = await db.execute(sql`SELECT * FROM stripe.customers WHERE id = ${customerId}`);
    return result.rows[0] ?? null;
  }

  async getInvoices(customerId: string) {
    const result = await db.execute(sql`
      SELECT id, amount_due, amount_paid, currency, status, created, hosted_invoice_url, invoice_pdf
      FROM stripe.invoices WHERE customer = ${customerId} ORDER BY created DESC LIMIT 12
    `);
    return result.rows;
  }

  // ── Organizations ────────────────────────────────────────────────────────────

  async getOrganization(id: number) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org ?? null;
  }

  async getOrganizationByEmail(email: string) {
    const [org] = await db.select().from(organizations).where(eq(organizations.email, email));
    return org ?? null;
  }

  async getOrganizationByStripeCustomerId(stripeCustomerId: string) {
    const [org] = await db.select().from(organizations).where(eq(organizations.stripeCustomerId, stripeCustomerId));
    return org ?? null;
  }

  async listOrganizations() {
    return db.select().from(organizations).orderBy(sql`${organizations.createdAt} DESC`);
  }

  async updateOrganization(id: number, data: Partial<typeof organizations.$inferInsert>) {
    const [org] = await db.update(organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return org;
  }

  async updateOrganizationByStripeCustomerId(stripeCustomerId: string, data: Partial<typeof organizations.$inferInsert>) {
    const [org] = await db.update(organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizations.stripeCustomerId, stripeCustomerId))
      .returning();
    return org;
  }
}

export const storage = new Storage();

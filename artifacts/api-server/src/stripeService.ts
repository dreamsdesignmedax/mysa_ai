import { getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

export class StripeService {
  async createCustomer(email: string, orgId: number, orgName: string) {
    const stripe = await getUncachableStripeClient();
    return stripe.customers.create({ email, name: orgName, metadata: { orgId: String(orgId) } });
  }

  async createCheckoutSession(opts: {
    customerId: string;
    priceId: string;
    orgId: number;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
  }) {
    const stripe = await getUncachableStripeClient();
    return stripe.checkout.sessions.create({
      customer: opts.customerId,
      payment_method_types: ['card'],
      line_items: [{ price: opts.priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      subscription_data: opts.trialDays ? { trial_period_days: opts.trialDays } : undefined,
      metadata: { orgId: String(opts.orgId) },
    });
  }

  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  }

  async getOrCreateCustomer(orgId: number): Promise<string> {
    const org = await storage.getOrganization(orgId);
    if (!org) throw new Error('Organization not found');
    if (org.stripeCustomerId) return org.stripeCustomerId;
    const customer = await this.createCustomer(org.email, org.id, org.name);
    await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
    return customer.id;
  }
}

export const stripeService = new StripeService();

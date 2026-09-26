import express from 'express';
import _ from 'lodash';
import { findUserById } from '../db/userRepository.js';

const router = express.Router();

/**
 * POST /api/v2/checkout
 * New v2 checkout endpoint introduced in v1.2.0.
 * Replaces the deprecated /api/v1/checkout.
 *
 * Body: { userId, cartItems: [{ sku, qty, price }] }
 */
router.post('/v2/checkout', async (req, res) => {
  const { userId, cartItems } = req.body;

  if (!userId || !Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({ error: 'userId and cartItems are required' });
  }

  const user = await findUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const featureFlagEnabled = process.env.FEATURE_FLAG_CHECKOUT_V2 === 'true';
  if (!featureFlagEnabled) {
    return res.status(503).json({ error: 'Checkout v2 is not yet enabled' });
  }

  // Compute order total using lodash v4 sumBy
  const total = _.sumBy(cartItems, (item) => item.qty * item.price);
  const orderId = `ORD-${Date.now()}`;

  res.status(201).json({ orderId, total, userId });
});

export default router;

-- Web Push is gone; proactive notifications are delivered to the user's linked
-- Telegram chat instead. A subscription row described one browser profile's
-- endpoint and its VAPID keys — there is nothing in it worth carrying over, and
-- `user.telegram_chat_id` is now what makes an account reachable.
DROP TABLE IF EXISTS "push_subscriptions";

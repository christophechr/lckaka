ALTER TABLE notification_deliveries DROP CONSTRAINT notification_deliveries_kind_check;
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_kind_check
  CHECK (kind IN ('reminder', 'result', 'prediction'));

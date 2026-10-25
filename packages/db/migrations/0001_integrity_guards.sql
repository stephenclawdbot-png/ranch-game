-- Integrity guards that must hold no matter which code path touches the database.
--
-- Ledger
--   * postings and transactions are append-only (no UPDATE / DELETE);
--   * a posting updates its account's cached balance (the only way a balance may change;
--     the ledger_accounts_non_negative CHECK then rejects overdrafts transactionally);
--   * at COMMIT every transaction must have >= 2 postings summing to exactly zero.
-- Horses
--   * horses are never deleted (no death, no deletion);
--   * Pasture / Legend is permanent; racing retirement is final; the career clock
--     (starts) and breeding_count never go backwards;
--   * ownership cannot change while a horse is race-locked or carrying a foal, and
--     bound (Club-bred) horses / foals below their trade threshold never change stables.

CREATE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_postings_append_only BEFORE UPDATE OR DELETE ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint
CREATE FUNCTION ledger_apply_posting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('thoroughbred.ledger_apply', 'on', true);
  UPDATE ledger_accounts SET balance = balance + NEW.amount WHERE id = NEW.ledger_account_id;
  PERFORM set_config('thoroughbred.ledger_apply', 'off', true);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_postings_apply AFTER INSERT ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_posting();
--> statement-breakpoint
CREATE FUNCTION ledger_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance IS DISTINCT FROM OLD.balance
     AND coalesce(current_setting('thoroughbred.ledger_apply', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'ledger balances change only through postings'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_accounts_balance_guard BEFORE UPDATE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_balance_guard();
--> statement-breakpoint
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
  n integer;
BEGIN
  SELECT coalesce(sum(amount), 0), count(*) INTO total, n
    FROM ledger_postings WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 OR n < 2 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (sum %, postings %)', NEW.transaction_id, total, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_postings_balanced AFTER INSERT ON ledger_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
--> statement-breakpoint
CREATE FUNCTION horses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'horses are permanent and cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.career_status = 'pasture' AND NEW.career_status <> 'pasture' THEN
    RAISE EXCEPTION 'pasture is permanent' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.career_status <> 'racing' AND NEW.career_status = 'racing' THEN
    RAISE EXCEPTION 'racing retirement is final' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.starts < OLD.starts OR NEW.breeding_count < OLD.breeding_count THEN
    RAISE EXCEPTION 'career starts and breeding count never decrease' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.owner_stable_id IS DISTINCT FROM OLD.owner_stable_id THEN
    -- Stable-to-stable transfers (sales); release to the Club (owner -> null) is always allowed.
    IF OLD.owner_stable_id IS NOT NULL AND NEW.owner_stable_id IS NOT NULL THEN
      IF OLD.bound THEN
        RAISE EXCEPTION 'Club-bred (bound) horses cannot be transferred' USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.starts < OLD.trade_min_starts THEN
        RAISE EXCEPTION 'horse needs % starts before it can be transferred', OLD.trade_min_starts
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    IF OLD.lock_kind = 'race' THEN
      RAISE EXCEPTION 'cannot transfer a horse entered in a race' USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM pregnancies p WHERE p.dam_id = OLD.id AND p.status = 'carrying') THEN
      RAISE EXCEPTION 'cannot transfer a mare in foal' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER horses_guard_update BEFORE UPDATE ON horses
  FOR EACH ROW EXECUTE FUNCTION horses_guard();
--> statement-breakpoint
CREATE TRIGGER horses_guard_delete BEFORE DELETE ON horses
  FOR EACH ROW EXECUTE FUNCTION horses_guard();
--> statement-breakpoint
INSERT INTO ledger_accounts (kind, currency, allow_negative) VALUES
  ('mint', 'CR', true),
  ('burn', 'CR', false),
  ('treasury', 'CR', false),
  ('escrow', 'CR', false);

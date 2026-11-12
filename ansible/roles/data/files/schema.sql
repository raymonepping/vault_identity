-- The finance database of Corvid Ledger (fictional). Vault's finance-readonly
-- role grants SELECT on ledger_entries to each generated user.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id           serial PRIMARY KEY,
  booked_on    date   NOT NULL,
  account      text   NOT NULL,
  description  text   NOT NULL,
  amount_cents bigint NOT NULL
);
REVOKE ALL ON ledger_entries FROM PUBLIC;
WITH ins AS (
  INSERT INTO ledger_entries (booked_on, account, description, amount_cents)
  SELECT * FROM (VALUES
    (DATE '2026-10-01', '4000-revenue',   'Freight invoices, week 40', 1843200),
    (DATE '2026-10-08', '4000-revenue',   'Freight invoices, week 41', 1712050),
    (DATE '2026-10-12', '6100-fuel',      'Fuel cards, October',      -412375),
    (DATE '2026-10-15', '6200-rent',      'Depot rent, Q4',           -900000),
    (DATE '2026-10-22', '4000-revenue',   'Freight invoices, week 43', 1655900),
    (DATE '2026-10-31', '2100-payroll',   'Payroll run, October',    -2480000)
  ) AS v(booked_on, account, description, amount_cents)
  WHERE NOT EXISTS (SELECT 1 FROM ledger_entries)
  RETURNING 1
)
SELECT count(*) FROM ins;

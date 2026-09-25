-- Only initialize untouched catalogs. A non-default value means an administrator
-- has already chosen an order, so leave the entire catalog as it is.
UPDATE resume_templates AS template
JOIN (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY id) * 10 AS next_sort_order,
    COUNT(*) OVER () AS template_count
  FROM resume_templates
) AS ranked ON ranked.id = template.id
JOIN (
  SELECT COUNT(*) AS custom_count
  FROM resume_templates
  WHERE sort_order <> 1000
) AS existing_order
SET template.sort_order = ranked.next_sort_order
WHERE existing_order.custom_count = 0
  AND ranked.template_count <= 100000;

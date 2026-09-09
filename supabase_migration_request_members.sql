-- 1. Add a new column pradesh_id to request_members that references the pradesh table
ALTER TABLE public.request_members ADD COLUMN pradesh_id INT REFERENCES public.pradesh(id);

-- 2. Try to map existing string pradesh names to pradesh_id if they match perfectly (optional data recovery)
UPDATE public.request_members rm
SET pradesh_id = p.id
FROM public.pradesh p
WHERE rm.pradesh = p.name;

-- 3. Drop the old varchar column
ALTER TABLE public.request_members DROP COLUMN pradesh;

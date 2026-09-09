-- 1. Remove the foreign key constraint and column if it was already created
ALTER TABLE public.users DROP COLUMN IF EXISTS pradesh_id;

-- 2. Drop the existing pradesh table (to remove the UUID version)
DROP TABLE IF EXISTS public.pradesh CASCADE;

-- 3. Create the pradesh table with an auto-incrementing integer ID
CREATE TABLE public.pradesh (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

-- 4. Insert states (Pradesh) of India
INSERT INTO public.pradesh (name) VALUES 
('Andhra Pradesh'),
('Arunachal Pradesh'),
('Assam'),
('Bihar'),
('Chhattisgarh'),
('Goa'),
('Gujarat'),
('Haryana'),
('Himachal Pradesh'),
('Jharkhand'),
('Karnataka'),
('Kerala'),
('Madhya Pradesh'),
('Maharashtra'),
('Manipur'),
('Meghalaya'),
('Mizoram'),
('Nagaland'),
('Odisha'),
('Punjab'),
('Rajasthan'),
('Sikkim'),
('Tamil Nadu'),
('Telangana'),
('Tripura'),
('Uttar Pradesh'),
('Uttarakhand'),
('West Bengal'),
('Andaman and Nicobar Islands'),
('Chandigarh'),
('Dadra and Nagar Haveli and Daman and Diu'),
('Delhi'),
('Jammu and Kashmir'),
('Ladakh'),
('Lakshadweep'),
('Puducherry')
ON CONFLICT (name) DO NOTHING;

-- 5. Add the pradesh_id column back to users table as an INTEGER
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pradesh_id INTEGER REFERENCES public.pradesh(id);

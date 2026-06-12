"""
Load lawyer/advocate data from Excel into Supabase
"""
import os
import sys
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

# Load environment variables
load_dotenv()

# Configuration
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def load_lawyers():
    """Load lawyer data from Excel"""
    print("\n" + "="*60)
    print("LOADING LAWYER DATA")
    print("="*60 + "\n")
    
    # Read Excel - try complete file first, then fallback to original
    excel_path = "data/Advocate list complete.xlsx"
    if not os.path.exists(excel_path):
        excel_path = "data/Advocate list.xlsx"
        if not os.path.exists(excel_path):
            print(f"❌ Error: File not found: {excel_path}")
            sys.exit(1)
    
    print(f"📄 Reading: {excel_path}")
    df = pd.read_excel(excel_path)
    print(f"✓ Found {len(df)} lawyers\n")
    
    # Display columns to understand structure
    print("Excel Columns:", df.columns.tolist())
    print("\nFirst row sample:")
    print(df.head(1).to_dict('records'))
    print()
    
    # Process and insert each lawyer
    success_count = 0
    for idx, row in df.iterrows():
        try:
            # Map Excel columns to database schema
            
            # Parse specialization (could be comma-separated string)
            specialization_raw = str(row.get('Specializations', row.get('specialization', row.get('practice_area', 'General'))))
            specialization = [s.strip() for s in specialization_raw.split(',') if s.strip()]
            
            # Get bar council ID or generate unique one if missing
            bar_id = row.get('bar_id', row.get('Bar_Council_ID', row.get('registration_no', '')))
            if pd.isna(bar_id) or str(bar_id).strip() == '' or str(bar_id).lower() == 'nan':
                # Generate unique ID based on name and index
                name_part = str(row.get('Name', f'Advocate{idx}')).replace(' ', '')[:10]
                bar_id = f"BC-{name_part}-{idx+1:04d}"
            else:
                bar_id = str(bar_id).strip()
            
            # Get profile link if available (check multiple possible column names)
            profile_link = row.get('Profile Link', row.get('profile_link', row.get('Profile_Link', row.get('linkedin', row.get('website', '')))))
            if pd.isna(profile_link) or str(profile_link).strip() == '' or str(profile_link).lower() == 'nan':
                profile_link = None
            else:
                profile_link = str(profile_link).strip()
            
            lawyer_data = {
                "name": str(row.get('Name', row.get('name', row.get('advocate_name', f'Advocate {idx+1}')))),
                "specialization": specialization,
                "city": str(row.get('District', row.get('city', row.get('location', 'Karachi')))),
                "experience_years": int(row.get('Experience', row.get('experience', row.get('years_experience', 0)))) if pd.notna(row.get('Experience', 0)) else 0,
                "total_cases": int(row.get('total_cases', 0)) if pd.notna(row.get('total_cases', 0)) else 0,
                "contact_email": str(row.get('email', row.get('Email', ''))),
                "contact_phone": str(row.get('phone', row.get('Phone', row.get('contact', '')))),
                "bar_council_id": bar_id,
                "rating": float(row.get('rating', 0)) if pd.notna(row.get('rating')) else 0.0,
                "profile_link": profile_link
            }
            
            # Insert into database
            print(f"Inserting: {lawyer_data['name']} (Bar ID: {bar_id})")
            supabase.table("lawyers").insert(lawyer_data).execute()
            success_count += 1
            print(f"✓ Inserted: {lawyer_data['name']}")
            
        except Exception as e:
            print(f"❌ Error inserting row {idx}: {str(e)}")
            print(f"   Row data: {row.to_dict()}")
            continue
    
    print(f"\n{'='*60}")
    print(f"✅ Successfully loaded {success_count}/{len(df)} lawyers")
    print("="*60 + "\n")

if __name__ == "__main__":
    if not all([SUPABASE_URL, SUPABASE_KEY]):
        print("❌ Error: Missing environment variables!")
        sys.exit(1)
    
    load_lawyers()

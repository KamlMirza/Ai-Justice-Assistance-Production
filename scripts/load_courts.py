"""
Load court data from CSV into Supabase
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

def load_courts():
    """Load court data from CSV"""
    print("\n" + "="*60)
    print("LOADING COURT DATA")
    print("="*60 + "\n")
    
    # Read CSV
    csv_path = "data/sindh_courts.csv"
    if not os.path.exists(csv_path):
        print(f"❌ Error: File not found: {csv_path}")
        sys.exit(1)
    
    print(f"📄 Reading: {csv_path}")
    df = pd.read_csv(csv_path)
    print(f"✓ Found {len(df)} courts\n")
    
    # Display columns to understand structure
    print("CSV Columns:", df.columns.tolist())
    print("\nFirst row sample:")
    print(df.head(1).to_dict('records'))
    print()
    
    # Process and insert each court
    success_count = 0
    for idx, row in df.iterrows():
        try:
            # Extract court name from CSV
            court_name = str(row.get('Court_Name', f'Court {idx+1}'))
            
            # Determine court type from jurisdiction description
            jurisdiction_desc = str(row.get('Jurisdiction_Description', ''))
            if 'Criminal' in jurisdiction_desc and 'Civil' in jurisdiction_desc:
                court_type = 'Civil'  # Mixed jurisdiction, default to Civil
            elif 'Criminal' in jurisdiction_desc or 'Terrorism' in jurisdiction_desc:
                court_type = 'Criminal'
            elif 'Family' in jurisdiction_desc or 'Marriage' in jurisdiction_desc or 'Divorce' in jurisdiction_desc:
                court_type = 'Family'
            else:
                court_type = 'Civil'
            
            court_data = {
                "name": court_name,
                "type": court_type,
                "jurisdiction": jurisdiction_desc,
                "city": "Karachi",  # All Sindh courts
                "address": "",
                "contact_info": {}
            }
            
            # Insert into database
            supabase.table("courts").insert(court_data).execute()
            success_count += 1
            print(f"✓ Inserted: {court_name} ({court_type})")
            
        except Exception as e:
            print(f"❌ Error inserting row {idx}: {str(e)}")
            print(f"   Row data: {row.to_dict()}")
            continue
    
    print(f"\n{'='*60}")
    print(f"✅ Successfully loaded {success_count}/{len(df)} courts")
    print("="*60 + "\n")

if __name__ == "__main__":
    if not all([SUPABASE_URL, SUPABASE_KEY]):
        print("❌ Error: Missing environment variables!")
        sys.exit(1)
    
    load_courts()

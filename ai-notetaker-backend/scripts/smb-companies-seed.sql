-- SMB Companies Seed - Businesses that need call transcription & AI receptionist
-- These are small-medium businesses that actually make/receive lots of phone calls

INSERT INTO companies (name, domain, industry, company_size, source) VALUES
    -- Local Home Services Franchises
    ('Mr. Rooter Plumbing', 'mrrooter.com', 'home_services', 'medium', 'manual'),
    ('ServiceMaster', 'servicemaster.com', 'home_services', 'large', 'manual'),
    ('Two Maids & A Mop', 'twomaidsandamop.com', 'home_services', 'medium', 'manual'),
    ('The Cleaning Authority', 'thecleaningauthority.com', 'home_services', 'medium', 'manual'),
    ('Molly Maid', 'mollymaid.com', 'home_services', 'medium', 'manual'),
    ('Mosquito Joe', 'mosquitojoe.com', 'home_services', 'small', 'manual'),
    ('Mr. Electric', 'mrelectric.com', 'home_services', 'medium', 'manual'),
    ('Aire Serv', 'aireserv.com', 'home_services', 'medium', 'manual'),
    ('Glass Doctor', 'glassdoctor.com', 'home_services', 'medium', 'manual'),
    ('Five Star Painting', 'fivestarpainting.com', 'home_services', 'medium', 'manual'),

    -- Medical/Dental Practices (networks)
    ('Aspen Dental', 'aspendental.com', 'healthcare', 'large', 'manual'),
    ('Heartland Dental', 'heartland.com', 'healthcare', 'large', 'manual'),
    ('Pacific Dental Services', 'pacificdentalservices.com', 'healthcare', 'large', 'manual'),
    ('Smile Brands', 'smilebrands.com', 'healthcare', 'large', 'manual'),
    ('CareNow Urgent Care', 'carenow.com', 'healthcare', 'medium', 'manual'),
    ('MedExpress', 'medexpress.com', 'healthcare', 'large', 'manual'),
    ('CityMD', 'citymd.com', 'healthcare', 'medium', 'manual'),
    ('Concentra', 'concentra.com', 'healthcare', 'large', 'manual'),

    -- Real Estate Brokerages (smaller/regional)
    ('Compass', 'compass.com', 'real_estate', 'large', 'manual'),
    ('Redfin', 'redfin.com', 'real_estate', 'large', 'manual'),
    ('eXp Realty', 'exprealty.com', 'real_estate', 'large', 'manual'),
    ('HomeSmart', 'homesmart.com', 'real_estate', 'medium', 'manual'),
    ('Weichert Realtors', 'weichert.com', 'real_estate', 'large', 'manual'),
    ('Better Homes and Gardens Real Estate', 'bhgre.com', 'real_estate', 'large', 'manual'),
    ('Howard Hanna', 'howardhanna.com', 'real_estate', 'medium', 'manual'),
    ('Long & Foster', 'longandfoster.com', 'real_estate', 'medium', 'manual'),
    ('Windermere', 'windermere.com', 'real_estate', 'medium', 'manual'),

    -- Insurance Agencies (independent/regional)
    ('Goosehead Insurance', 'gooseheadinsurance.com', 'insurance', 'medium', 'manual'),
    ('Brightway Insurance', 'brightway.com', 'insurance', 'medium', 'manual'),
    ('Insphere Insurance', 'insphereinsurance.com', 'insurance', 'medium', 'manual'),
    ('World Financial Group', 'worldfinancialgroup.com', 'insurance', 'medium', 'manual'),
    ('Bankers Life', 'bankerslife.com', 'insurance', 'large', 'manual'),
    ('Family First Life', 'familyfirstlife.com', 'insurance', 'medium', 'manual'),
    ('Primerica', 'primerica.com', 'insurance', 'large', 'manual'),
    ('Symmetry Financial', 'sfglife.com', 'insurance', 'medium', 'manual'),

    -- Auto Dealerships (groups)
    ('AutoNation', 'autonation.com', 'automotive', 'large', 'manual'),
    ('Penske Automotive', 'penskeautomotive.com', 'automotive', 'large', 'manual'),
    ('Sonic Automotive', 'sonicautomotive.com', 'automotive', 'large', 'manual'),
    ('Group 1 Automotive', 'group1auto.com', 'automotive', 'large', 'manual'),
    ('Asbury Automotive', 'asburyauto.com', 'automotive', 'large', 'manual'),
    ('Lithia Motors', 'lithia.com', 'automotive', 'large', 'manual'),
    ('Hendrick Automotive', 'hendrickauto.com', 'automotive', 'large', 'manual'),
    ('Larry H. Miller', 'lhm.com', 'automotive', 'large', 'manual'),
    ('CarMax', 'carmax.com', 'automotive', 'large', 'manual'),

    -- Financial Advisors / Wealth Management
    ('Edward Jones', 'edwardjones.com', 'finance', 'large', 'manual'),
    ('Raymond James', 'raymondjames.com', 'finance', 'large', 'manual'),
    ('Ameriprise', 'ameriprise.com', 'finance', 'large', 'manual'),
    ('LPL Financial', 'lpl.com', 'finance', 'large', 'manual'),
    ('Northwestern Mutual', 'northwesternmutual.com', 'finance', 'large', 'manual'),
    ('Stifel', 'stifel.com', 'finance', 'large', 'manual'),
    ('Baird', 'bairdwealth.com', 'finance', 'large', 'manual'),
    ('Cetera', 'cetera.com', 'finance', 'large', 'manual'),

    -- Mortgage / Lending
    ('Rocket Mortgage', 'rocketmortgage.com', 'mortgage', 'large', 'manual'),
    ('LoanDepot', 'loandepot.com', 'mortgage', 'large', 'manual'),
    ('Fairway Independent Mortgage', 'fairwaymc.com', 'mortgage', 'large', 'manual'),
    ('Caliber Home Loans', 'caliberhomeloans.com', 'mortgage', 'large', 'manual'),
    ('Movement Mortgage', 'movement.com', 'mortgage', 'large', 'manual'),
    ('CrossCountry Mortgage', 'crosscountrymortgage.com', 'mortgage', 'large', 'manual'),
    ('Guild Mortgage', 'guildmortgage.com', 'mortgage', 'large', 'manual'),
    ('Finance of America', 'financeofamerica.com', 'mortgage', 'large', 'manual'),

    -- Staffing / Recruiting (SMB focused)
    ('Express Employment', 'expresspros.com', 'staffing', 'large', 'manual'),
    ('Spherion', 'spherion.com', 'staffing', 'large', 'manual'),
    ('Adecco', 'adecco.com', 'staffing', 'large', 'manual'),
    ('Kelly Services', 'kellyservices.com', 'staffing', 'large', 'manual'),
    ('Aerotek', 'aerotek.com', 'staffing', 'large', 'manual'),
    ('Insight Global', 'insightglobal.com', 'staffing', 'large', 'manual'),
    ('AppleOne', 'appleone.com', 'staffing', 'medium', 'manual'),
    ('The Reserves Network', 'trnstaffing.com', 'staffing', 'medium', 'manual'),

    -- Law Firms (smaller regional)
    ('Morgan & Morgan', 'forthepeople.com', 'legal', 'large', 'manual'),
    ('Jacoby & Meyers', 'jacobyandmeyers.com', 'legal', 'medium', 'manual'),
    ('Cellino & Barnes (now Cellino Law)', 'cellinolaw.com', 'legal', 'medium', 'manual'),
    ('Brown & Crouppen', 'getbc.com', 'legal', 'medium', 'manual'),
    ('Fieger Law', 'fiegerlaw.com', 'legal', 'medium', 'manual'),
    ('Sokolove Law', 'sokolovelaw.com', 'legal', 'medium', 'manual'),
    ('Riddle & Brantley', 'justicecounts.com', 'legal', 'medium', 'manual'),
    ('Goldberg & Osborne', 'goldbergandosborne.com', 'legal', 'medium', 'manual'),

    -- Veterinary Clinics (networks)
    ('VCA Animal Hospitals', 'vcahospitals.com', 'veterinary', 'large', 'manual'),
    ('Banfield Pet Hospital', 'banfield.com', 'veterinary', 'large', 'manual'),
    ('BluePearl Specialty', 'bluepearlvet.com', 'veterinary', 'large', 'manual'),
    ('National Veterinary Associates', 'nva.com', 'veterinary', 'large', 'manual'),
    ('PetVet Care Centers', 'petvetcarecenters.com', 'veterinary', 'large', 'manual'),
    ('Thrive Pet Healthcare', 'thrivepet.com', 'veterinary', 'large', 'manual'),

    -- Fitness/Wellness (chains with lots of calls)
    ('Orangetheory Fitness', 'orangetheory.com', 'fitness', 'large', 'manual'),
    ('Massage Envy', 'massageenvy.com', 'wellness', 'large', 'manual'),
    ('European Wax Center', 'waxcenter.com', 'wellness', 'large', 'manual'),
    ('Hand & Stone', 'handandstone.com', 'wellness', 'large', 'manual'),
    ('Elements Massage', 'elementsmassage.com', 'wellness', 'medium', 'manual'),
    ('Stretch Lab', 'stretchlab.com', 'wellness', 'medium', 'manual'),
    ('Restore Hyper Wellness', 'restore.com', 'wellness', 'medium', 'manual'),
    ('HOTWORX', 'hotworx.net', 'fitness', 'medium', 'manual'),

    -- Travel Agencies
    ('Travel Leaders', 'travelleaders.com', 'travel', 'medium', 'manual'),
    ('Cruise Planners', 'cruiseplanners.com', 'travel', 'medium', 'manual'),
    ('Dream Vacations', 'dreamvacations.com', 'travel', 'medium', 'manual'),
    ('Avoya Travel', 'avoyatravel.com', 'travel', 'medium', 'manual'),
    ('Expedia Cruises', 'expediacruises.com', 'travel', 'medium', 'manual'),

    -- Senior Care Services
    ('Home Instead', 'homeinstead.com', 'senior_care', 'large', 'manual'),
    ('Comfort Keepers', 'comfortkeepers.com', 'senior_care', 'large', 'manual'),
    ('BrightStar Care', 'brightstarcare.com', 'senior_care', 'large', 'manual'),
    ('Visiting Angels', 'visitingangels.com', 'senior_care', 'large', 'manual'),
    ('Right at Home', 'rightathome.net', 'senior_care', 'large', 'manual'),
    ('Griswold Home Care', 'griswoldhomecare.com', 'senior_care', 'medium', 'manual'),
    ('SYNERGY HomeCare', 'synergyhomecare.com', 'senior_care', 'medium', 'manual'),

    -- Tutoring / Education Services
    ('Kumon', 'kumon.com', 'education', 'large', 'manual'),
    ('Mathnasium', 'mathnasium.com', 'education', 'large', 'manual'),
    ('Sylvan Learning', 'sylvanlearning.com', 'education', 'large', 'manual'),
    ('Huntington Learning', 'huntingtonhelps.com', 'education', 'large', 'manual'),
    ('Tutor Doctor', 'tutordoctor.com', 'education', 'medium', 'manual'),
    ('Club Z! In-Home Tutoring', 'clubztutoring.com', 'education', 'medium', 'manual'),

    -- Tax/Accounting Services
    ('H&R Block', 'hrblock.com', 'accounting', 'large', 'manual'),
    ('Jackson Hewitt', 'jacksonhewitt.com', 'accounting', 'large', 'manual'),
    ('Liberty Tax', 'libertytax.com', 'accounting', 'large', 'manual'),
    ('Padgett Business Services', 'padgettbusinessservices.com', 'accounting', 'medium', 'manual'),
    ('ATAX', 'atax.com', 'accounting', 'medium', 'manual'),

    -- Property Management
    ('Greystar', 'greystar.com', 'property_management', 'large', 'manual'),
    ('Lincoln Property Company', 'lincolnapts.com', 'property_management', 'large', 'manual'),
    ('BH Management', 'bhmanagement.com', 'property_management', 'large', 'manual'),
    ('Camden Property Trust', 'camdenliving.com', 'property_management', 'large', 'manual'),
    ('Morgan Properties', 'morgan-properties.com', 'property_management', 'large', 'manual'),
    ('Equity Residential', 'equityapartments.com', 'property_management', 'large', 'manual'),

    -- Pet Services
    ('Camp Bow Wow', 'campbowwow.com', 'pet_services', 'medium', 'manual'),
    ('Dogtopia', 'dogtopia.com', 'pet_services', 'medium', 'manual'),
    ('Pet Supplies Plus', 'petsuppliesplus.com', 'pet_services', 'large', 'manual'),
    ('Petland', 'petland.com', 'pet_services', 'medium', 'manual'),
    ('PetSuites', 'petsuites.com', 'pet_services', 'medium', 'manual'),

    -- Restoration Services (water/fire damage)
    ('SERVPRO', 'servpro.com', 'restoration', 'large', 'manual'),
    ('ServiceMaster Restore', 'servicemasterrestore.com', 'restoration', 'large', 'manual'),
    ('Belfor', 'belfor.com', 'restoration', 'large', 'manual'),
    ('Paul Davis Restoration', 'pauldavis.com', 'restoration', 'large', 'manual'),
    ('Rainbow International', 'rainbowintl.com', 'restoration', 'medium', 'manual'),
    ('PuroClean', 'puroclean.com', 'restoration', 'medium', 'manual'),

    -- Pest Control
    ('Orkin', 'orkin.com', 'pest_control', 'large', 'manual'),
    ('Terminix', 'terminix.com', 'pest_control', 'large', 'manual'),
    ('Rentokil', 'rentokil.com', 'pest_control', 'large', 'manual'),
    ('Aptive Environmental', 'goaptive.com', 'pest_control', 'medium', 'manual'),
    ('ABC Home & Commercial', 'abchomeandcommercial.com', 'pest_control', 'medium', 'manual'),

    -- Roofing Companies
    ('Roof-A-Cide', 'roofacide.com', 'roofing', 'small', 'manual'),
    ('Power Home Remodeling', 'powerhrg.com', 'roofing', 'large', 'manual'),
    ('Leaf Home', 'leafhome.com', 'roofing', 'large', 'manual'),
    ('Centimark', 'centimark.com', 'roofing', 'large', 'manual')

ON CONFLICT (domain) DO NOTHING;

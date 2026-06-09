"""
GST Validation Utility
Validates GSTIN format and state codes
"""
import re
from typing import Dict, Tuple

# GST State Code Mapping
GST_STATE_CODES = {
    '01': 'Jammu and Kashmir',
    '02': 'Himachal Pradesh',
    '03': 'Punjab',
    '04': 'Chandigarh',
    '05': 'Uttarakhand',
    '06': 'Haryana',
    '07': 'Delhi',
    '08': 'Rajasthan',
    '09': 'Uttar Pradesh',
    '10': 'Bihar',
    '11': 'Sikkim',
    '12': 'Arunachal Pradesh',
    '13': 'Nagaland',
    '14': 'Manipur',
    '15': 'Mizoram',
    '16': 'Tripura',
    '17': 'Meghalaya',
    '18': 'Assam',
    '19': 'West Bengal',
    '20': 'Jharkhand',
    '21': 'Odisha',
    '22': 'Chhattisgarh',
    '23': 'Madhya Pradesh',
    '24': 'Gujarat',
    '25': 'Daman and Diu',
    '26': 'Dadra and Nagar Haveli',
    '27': 'Maharashtra',
    '28': 'Andhra Pradesh',
    '29': 'Karnataka',
    '30': 'Goa',
    '31': 'Lakshadweep',
    '32': 'Kerala',
    '33': 'Tamil Nadu',
    '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands',
    '36': 'Telangana',
    '37': 'Andhra Pradesh (New)',
    '38': 'Ladakh',
    '97': 'Other Territory',
    '99': 'Centre Jurisdiction'
}


def validate_gstin_format(gstin: str) -> Tuple[bool, str]:
    """
    Validate GSTIN format

    GSTIN Format: 2 digits (state code) + 10 characters (PAN) + 1 digit (entity number)
                  + 1 letter (Z - default) + 1 alphanumeric (checksum)

    Example: 27AABCU9603R1ZV

    Returns:
        Tuple[bool, str]: (is_valid, error_message)
    """
    if not gstin:
        return True, ""  # GST is optional

    # Remove whitespace and convert to uppercase
    gstin = gstin.strip().upper()

    # Check length
    if len(gstin) != 15:
        return False, "GSTIN must be exactly 15 characters"

    # Validate format using regex
    # Pattern: 2 digits + 5 letters + 4 digits + 1 letter + 1 alphanumeric + Z + 1 alphanumeric
    pattern = r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'

    if not re.match(pattern, gstin):
        return False, "Invalid GSTIN format. Expected format: 27AABCU9603R1ZV"

    # Validate state code
    state_code = gstin[:2]
    if state_code not in GST_STATE_CODES:
        return False, f"Invalid state code: {state_code}"

    # Check if 14th character is 'Z'
    if gstin[13] != 'Z':
        return False, "14th character must be 'Z'"

    return True, ""


def validate_state_match(gstin: str, state_name: str) -> Tuple[bool, str]:
    """
    Validate if the state code in GSTIN matches the provided state name

    Args:
        gstin: GSTIN number
        state_name: State name from the form

    Returns:
        Tuple[bool, str]: (is_match, warning_message)
    """
    if not gstin or not state_name:
        return True, ""

    gstin = gstin.strip().upper()
    state_code = gstin[:2]

    if state_code not in GST_STATE_CODES:
        return False, f"Invalid state code in GSTIN: {state_code}"

    gstin_state = GST_STATE_CODES[state_code]

    # Normalize state names for comparison
    normalized_input_state = state_name.strip().lower()
    normalized_gstin_state = gstin_state.strip().lower()

    if normalized_input_state != normalized_gstin_state:
        return False, f"State mismatch: GSTIN belongs to {gstin_state}, but you selected {state_name}"

    return True, ""


def validate_pincode_format(pincode: str) -> Tuple[bool, str]:
    """
    Validate Indian pincode format

    Args:
        pincode: Pincode string

    Returns:
        Tuple[bool, str]: (is_valid, error_message)
    """
    if not pincode:
        return True, ""  # Pincode is optional if GST details are optional

    pincode = pincode.strip()

    # Check if it's exactly 6 digits
    if not re.match(r'^[0-9]{6}$', pincode):
        return False, "Pincode must be exactly 6 digits"

    # First digit should not be 0
    if pincode[0] == '0':
        return False, "Invalid pincode: First digit cannot be 0"

    return True, ""


def validate_gst_details(gst_data: Dict) -> Dict:
    """
    Validate complete GST details

    Args:
        gst_data: Dictionary containing GST details
            - gstin: GSTIN number
            - gst_state: State name
            - gst_pincode: Pincode
            - gst_company_name: Company name
            - gst_address: Address
            - gst_city: City

    Returns:
        Dict with validation results:
            - valid: bool
            - errors: List of error messages
            - warnings: List of warning messages
    """
    errors = []
    warnings = []

    gstin = gst_data.get('gstin', '').strip()

    # If GSTIN is not provided, GST details are optional
    if not gstin:
        return {
            'valid': True,
            'errors': [],
            'warnings': []
        }

    # Validate GSTIN format
    format_valid, format_error = validate_gstin_format(gstin)
    if not format_valid:
        errors.append(format_error)
        return {
            'valid': False,
            'errors': errors,
            'warnings': warnings
        }

    # Validate state match
    state_name = gst_data.get('gst_state', '').strip()
    if state_name:
        state_match, state_error = validate_state_match(gstin, state_name)
        if not state_match:
            errors.append(state_error)
    else:
        errors.append("State is required when GSTIN is provided")

    # Validate pincode
    pincode = gst_data.get('gst_pincode', '').strip()
    if pincode:
        pincode_valid, pincode_error = validate_pincode_format(pincode)
        if not pincode_valid:
            errors.append(pincode_error)
    else:
        warnings.append("Pincode is recommended for GST details")

    # Check required fields when GSTIN is provided
    required_fields = {
        'gst_company_name': 'Company name',
        'gst_address': 'Address',
        'gst_city': 'City',
        'gst_state': 'State'
    }

    for field, label in required_fields.items():
        if not gst_data.get(field, '').strip():
            errors.append(f"{label} is required when GSTIN is provided")

    return {
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': warnings
    }


def get_state_from_gstin(gstin: str) -> str:
    """
    Extract state name from GSTIN

    Args:
        gstin: GSTIN number

    Returns:
        State name or empty string if invalid
    """
    if not gstin or len(gstin) < 2:
        return ""

    state_code = gstin[:2]
    return GST_STATE_CODES.get(state_code, "")

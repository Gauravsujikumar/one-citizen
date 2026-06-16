// profile_screen.dart - Citizen Profile (Digital Twin) Edit Portal
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = true;
  bool _isSaving = false;

  // Controllers
  final _nameController = TextEditingController();
  final _dobController = TextEditingController();
  final _occupationController = TextEditingController();
  final _educationController = TextEditingController();
  final _incomeController = TextEditingController();
  final _stateController = TextEditingController();
  final _districtController = TextEditingController();
  final _casteController = TextEditingController();
  
  String _gender = 'Male';
  bool _isFarmer = false;
  List<dynamic> _familyMembers = [];
  bool _isAadhaarLinked = false;

  @override
  void initState() {
    super.initState();
    _loadProfileData();
  }

  Future<void> _loadProfileData() async {
    try {
      final profile = await ApiService.getProfile();
      bool hasAadhaar = false;
      try {
        final docs = await ApiService.getDocuments();
        hasAadhaar = docs.any((doc) => doc['document_type'] == 'aadhaar');
      } catch (e) {
        // Fallback if document fetch fails
      }

      if (mounted) {
        setState(() {
          _nameController.text = profile['name'] ?? '';
          _dobController.text = profile['dob'] ?? '';
          _occupationController.text = profile['occupation'] ?? '';
          _educationController.text = profile['education'] ?? '';
          _incomeController.text = profile['income_amount']?.toString() ?? '0';
          _stateController.text = profile['state'] ?? '';
          _districtController.text = profile['district'] ?? '';
          _casteController.text = profile['caste'] ?? '';
          _gender = profile['gender'] == 'Female' ? 'Female' : 'Male';
          _isFarmer = profile['is_farmer'] == 1;
          _familyMembers = profile['family_members'] ?? [];
          _isAadhaarLinked = hasAadhaar;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSaving = true;
    });

    try {
      final data = {
        'name': _nameController.text,
        'dob': _dobController.text,
        'gender': _gender,
        'occupation': _occupationController.text,
        'education': _educationController.text,
        'income_category': double.parse(_incomeController.text) > 500000 ? 'high' : (double.parse(_incomeController.text) > 200000 ? 'medium' : 'low'),
        'income_amount': double.parse(_incomeController.text),
        'state': _stateController.text,
        'district': _districtController.text,
        'caste': _casteController.text,
        'is_farmer': _isFarmer,
        'family_members': _familyMembers
      };

      await ApiService.updateProfile(data);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Digital Twin profile saved successfully.')),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to save profile details.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govSaffron = Color(0xFFFF671F);
    const Color govEmerald = Color(0xFF046A38);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Citizen Digital Twin'),
        actions: [
          if (!_isLoading)
            IconButton(
              icon: _isSaving
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Icon(Icons.check),
              onPressed: _isSaving ? null : _saveProfile,
            )
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Your digital profile allows the copilot to run background checks and auto-fill certificate registration fields.',
                      style: TextStyle(color: Colors.grey, fontSize: 13, height: 1.3),
                    ),
                    const SizedBox(height: 25),

                    // Section: Basic Info
                    const Text('Demographic Information', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: govNavy)),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _nameController,
                      readOnly: _isAadhaarLinked && _nameController.text.isNotEmpty,
                      decoration: InputDecoration(
                        labelText: 'Full Name (As in Aadhaar)',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                        suffixIcon: (_isAadhaarLinked && _nameController.text.isNotEmpty) ? const Icon(Icons.lock, color: govEmerald, size: 18) : null,
                        helperText: (_isAadhaarLinked && _nameController.text.isNotEmpty) ? '🔒 Verified from Aadhaar' : null,
                        helperStyle: const TextStyle(color: govEmerald, fontWeight: FontWeight.bold),
                      ),
                      validator: (v) => v!.isEmpty ? 'Name is required' : null,
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _dobController,
                            readOnly: _isAadhaarLinked && _dobController.text.isNotEmpty,
                            decoration: InputDecoration(
                              labelText: 'DOB (DD/MM/YYYY)',
                              hintText: '05/10/2004',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                              suffixIcon: (_isAadhaarLinked && _dobController.text.isNotEmpty) ? const Icon(Icons.lock, color: govEmerald, size: 18) : null,
                              helperText: (_isAadhaarLinked && _dobController.text.isNotEmpty) ? '🔒 From Aadhaar' : null,
                              helperStyle: const TextStyle(color: govEmerald, fontWeight: FontWeight.bold),
                            ),
                            validator: (v) => v!.isEmpty ? 'DOB is required' : null,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: _gender,
                            decoration: InputDecoration(
                              labelText: 'Gender',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                              helperText: (_isAadhaarLinked && _gender.isNotEmpty) ? '🔒 From Aadhaar' : null,
                              helperStyle: const TextStyle(color: govEmerald, fontWeight: FontWeight.bold),
                            ),
                            items: ['Male', 'Female'].map((g) => DropdownMenuItem(value: g, child: Text(g))).toList(),
                            onChanged: (_isAadhaarLinked && _gender.isNotEmpty) ? null : (val) {
                              setState(() {
                                _gender = val!;
                              });
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 25),

                    // Section: Social Info
                    const Text('Socio-Economic Parameters', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: govNavy)),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _occupationController,
                      decoration: InputDecoration(
                        labelText: 'Occupation',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _incomeController,
                            keyboardType: TextInputType.number,
                            decoration: InputDecoration(
                              labelText: 'Annual Income (₹)',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: TextFormField(
                            controller: _casteController,
                            decoration: InputDecoration(
                              labelText: 'Social Category (SC/ST/OBC)',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    CheckboxListTile(
                      title: const Text('Are you a Landholding Farmer?', style: TextStyle(fontSize: 14)),
                      value: _isFarmer,
                      activeColor: govSaffron,
                      onChanged: (val) {
                        setState(() {
                          _isFarmer = val!;
                        });
                      },
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                    ),
                    const SizedBox(height: 25),

                    // Section: Geographic Info
                    const Text('Location Details', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: govNavy)),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _stateController,
                            readOnly: _isAadhaarLinked && _stateController.text.isNotEmpty,
                            decoration: InputDecoration(
                              labelText: 'State',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                              suffixIcon: (_isAadhaarLinked && _stateController.text.isNotEmpty) ? const Icon(Icons.lock, color: govEmerald, size: 18) : null,
                              helperText: (_isAadhaarLinked && _stateController.text.isNotEmpty) ? '🔒 From Aadhaar' : null,
                              helperStyle: const TextStyle(color: govEmerald, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: TextFormField(
                            controller: _districtController,
                            readOnly: _isAadhaarLinked && _districtController.text.isNotEmpty,
                            decoration: InputDecoration(
                              labelText: 'District',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                              suffixIcon: (_isAadhaarLinked && _districtController.text.isNotEmpty) ? const Icon(Icons.lock, color: govEmerald, size: 18) : null,
                              helperText: (_isAadhaarLinked && _districtController.text.isNotEmpty) ? '🔒 From Aadhaar' : null,
                              helperStyle: const TextStyle(color: govEmerald, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 40),

                    // Save Button
                    ElevatedButton(
                      onPressed: _isSaving ? null : _saveProfile,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: govNavy,
                        minimumSize: const Size.fromHeight(50),
                      ),
                      child: const Text('Update Digital Twin Parameters', style: TextStyle(fontWeight: FontWeight.bold)),
                    )
                  ],
                ),
              ),
            ),
    );
  }
}

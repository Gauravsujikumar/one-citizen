// vault_screen.dart - Citizen Smart Document Vault Portal
import 'dart:io';
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class VaultScreen extends StatefulWidget {
  const VaultScreen({super.key});

  @override
  State<VaultScreen> createState() => _VaultScreenState();
}

class _VaultScreenState extends State<VaultScreen> {
  bool _isLoading = true;
  List<dynamic> _documents = [];
  String _selectedDocType = 'aadhaar';

  @override
  void initState() {
    super.initState();
    _loadVaultData();
  }

  Future<void> _loadVaultData() async {
    setState(() {
      _isLoading = true;
    });
    try {
      final docs = await ApiService.getDocuments();
      if (mounted) {
        setState(() {
          _documents = docs;
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

  // Handle Mock File Picker & Upload
  Future<void> _uploadMockDocument() async {
    // Generate a temporary mock local file on the device
    final tempDir = Directory.systemTemp;
    final mockFile = File('${tempDir.path}/mock_upload_${_selectedDocType}.jpg');
    await mockFile.writeAsString('Fake document binary content');

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator()),
    );

    try {
      final response = await ApiService.uploadDocument(mockFile, _selectedDocType);
      
      if (mounted) {
        Navigator.pop(context); // Close loading dialog
        _loadVaultData(); // Refresh list

        // Display OCR results popup
        _showOCRResultsDialog(response['document']);
      }
    } catch (e) {
      if (mounted) {
        Navigator.pop(context); // Close loading dialog
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Upload failed. Check backend connection.')),
        );
      }
    }
  }

  void _showOCRResultsDialog(Map<String, dynamic> doc) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govEmerald = Color(0xFF046A38);

    showDialog(
      context: context,
      builder: (context) {
        final extData = doc['extracted_data'] as Map? ?? {};
        final validation = doc['validation'] as Map? ?? {};
        final issues = validation['issues'] as List? ?? [];

        return AlertDialog(
          title: Row(
            children: [
              const Icon(Icons.document_scanner, color: govNavy),
              const SizedBox(width: 10),
              const Text('OCR Scan Complete', style: TextStyle(fontWeight: FontWeight.bold)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Document Type: ${doc['document_type'].toString().toUpperCase()}', style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                const Divider(),
                const SizedBox(height: 10),
                const Text('Extracted Identity Parameters:', style: TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                ...extData.entries.map((entry) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(entry.key.toString().replaceFirst('_', ' ').toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      Text(entry.value.toString(), style: const TextStyle(fontSize: 12)),
                    ],
                  ),
                )).toList(),
                const SizedBox(height: 15),
                const Divider(),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Text('Validation Status: ', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: issues.isEmpty ? govEmerald.withOpacity(0.1) : Colors.amber.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        issues.isEmpty ? 'VERIFIED' : 'WARNINGS',
                        style: TextStyle(color: issues.isEmpty ? govEmerald : Colors.amber.shade900, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
                if (issues.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  ...issues.map((issue) => Text('• $issue', style: TextStyle(color: Colors.red.shade700, fontSize: 11))).toList(),
                ]
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Save to Vault', style: TextStyle(fontWeight: FontWeight.bold, color: govNavy)),
            )
          ],
        );
      },
    );
  }

  Future<void> _deleteDocument(String id) async {
    try {
      await ApiService.deleteDocument(id);
      _loadVaultData();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Document removed from Vault.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to delete document.')),
        );
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
        title: const Text('Smart Document Vault'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Vault header card
                  Card(
                    color: govNavy,
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        children: [
                          Row(
                            children: const [
                              Icon(Icons.lock, color: govSaffron, size: 28),
                              SizedBox(width: 12),
                              Text(
                                'Secure Gov-Cloud Vault',
                                style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                              )
                            ],
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'All documents are encrypted and cross-verified automatically against regional registrar directories.',
                            style: TextStyle(color: Colors.white70, fontSize: 12, height: 1.3),
                          )
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Upload controls row
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: _selectedDocType,
                          decoration: InputDecoration(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          items: const [
                            DropdownMenuItem(value: 'aadhaar', child: Text('Aadhaar Card')),
                            DropdownMenuItem(value: 'pan', child: Text('PAN Card')),
                            DropdownMenuItem(value: 'income', child: Text('Income Certificate')),
                            DropdownMenuItem(value: 'caste', child: Text('Caste Certificate')),
                            DropdownMenuItem(value: 'degree', child: Text('Degree Certificate')),
                            DropdownMenuItem(value: 'birth', child: Text('Birth Certificate')),
                          ],
                          onChanged: (val) {
                            setState(() {
                              _selectedDocType = val!;
                            });
                          },
                        ),
                      ),
                      const SizedBox(width: 10),
                      ElevatedButton.icon(
                        onPressed: _uploadMockDocument,
                        icon: const Icon(Icons.cloud_upload),
                        label: const Text('Upload'),
                      )
                    ],
                  ),
                  const SizedBox(height: 25),

                  const Text('Vaulted Certificates', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: govNavy)),
                  const SizedBox(height: 10),

                  // Documents list
                  Expanded(
                    child: _documents.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: const [
                                Icon(Icons.folder_open, size: 48, color: Colors.grey),
                                SizedBox(height: 10),
                                Text('Your Vault is empty. Upload core IDs.', style: TextStyle(color: Colors.grey)),
                              ],
                            ),
                          )
                        : ListView.builder(
                            itemCount: _documents.length,
                            itemBuilder: (context, index) {
                              final doc = _documents[index];
                              final isVerified = doc['is_verified'] == 1;

                              return Card(
                                margin: const EdgeInsets.symmetric(vertical: 8),
                                child: ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor: isVerified ? govEmerald.withOpacity(0.1) : Colors.amber.withOpacity(0.1),
                                    child: Icon(
                                      isVerified ? Icons.verified_user : Icons.warning_amber,
                                      color: isVerified ? govEmerald : Colors.amber.shade900,
                                    ),
                                  ),
                                  title: Text(
                                    doc['document_type'].toString().toUpperCase(),
                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                  ),
                                  subtitle: Text(
                                    'ID: ${doc['extracted_id_number'] ?? 'Loading...'}',
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                  trailing: IconButton(
                                    icon: const Icon(Icons.delete_outline, color: Colors.red),
                                    onPressed: () => _deleteDocument(doc['id']),
                                  ),
                                  onTap: () => _showOCRResultsDialog(doc),
                                ),
                              );
                            },
                          ),
                  )
                ],
              ),
            ),
    );
  }
}

// service_discovery_screen.dart - Catalog & Readiness Score Screen
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ServiceDiscoveryScreen extends StatefulWidget {
  const ServiceDiscoveryScreen({super.key});

  @override
  State<ServiceDiscoveryScreen> createState() => _ServiceDiscoveryScreenState();
}

class _ServiceDiscoveryScreenState extends State<ServiceDiscoveryScreen> {
  bool _isLoading = true;
  List<dynamic> _services = [];
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadServices();
  }

  Future<void> _loadServices({String? query}) async {
    setState(() {
      _isLoading = true;
    });
    try {
      final catalog = await ApiService.getServices(search: query);
      if (mounted) {
        setState(() {
          _services = catalog;
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

  void _showServiceDetails(Map<String, dynamic> s) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govSaffron = Color(0xFFFF671F);

    showDialog(
      context: context,
      builder: (context) {
        final docs = s['required_documents'] as List? ?? [];
        final steps = s['steps'] as List? ?? [];

        return AlertDialog(
          title: Text(s['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, color: govNavy)),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Fee: ₹${s['fees']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    Text('Time: ${s['processing_time']}', style: const TextStyle(color: Colors.grey, fontSize: 13)),
                  ],
                ),
                const SizedBox(height: 15),
                const Divider(),
                const SizedBox(height: 10),
                const Text('Required Documents:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: govNavy)),
                const SizedBox(height: 5),
                Wrap(
                  spacing: 6,
                  children: docs.map((d) => Chip(
                    label: Text(d.toString().toUpperCase(), style: const TextStyle(fontSize: 10, color: govNavy)),
                    backgroundColor: govNavy.withOpacity(0.05),
                  )).toList(),
                ),
                const SizedBox(height: 15),
                const Text('Process Steps:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: govNavy)),
                const SizedBox(height: 5),
                ...steps.asMap().entries.map((entry) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4.0),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${entry.key + 1}. ', style: const TextStyle(fontWeight: FontWeight.bold)),
                        Expanded(child: Text(entry.value.toString(), style: const TextStyle(fontSize: 12))),
                      ],
                    ),
                  );
                }).toList(),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                _checkReadiness(s);
              },
              style: ElevatedButton.styleFrom(backgroundColor: govSaffron),
              child: const Text('Check Readiness'),
            )
          ],
        );
      },
    );
  }

  // Calculate readiness score and show Readiness screen mockup
  Future<void> _checkReadiness(Map<String, dynamic> s) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator()),
    );

    try {
      final readiness = await ApiService.getReadinessScore(s['id']);
      if (mounted) {
        Navigator.pop(context); // Close loading dialog
        _showReadinessScoreSheet(s, readiness);
      }
    } catch (e) {
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to calculate readiness. Check vault docs.')),
        );
      }
    }
  }

  void _showReadinessScoreSheet(Map<String, dynamic> service, Map<String, dynamic> readiness) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govSaffron = Color(0xFFFF671F);
    const Color govEmerald = Color(0xFF046A38);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        final score = readiness['readiness_score'] as int? ?? 0;
        final issues = readiness['issues'] as List? ?? [];
        final docAnalysis = readiness['document_analysis'] as List? ?? [];

        return DraggableScrollableSheet(
          initialChildSize: 0.8,
          maxChildSize: 0.95,
          minChildSize: 0.5,
          expand: false,
          builder: (context, scrollController) {
            return SingleChildScrollView(
              controller: scrollController,
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 5,
                      decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text('Application Readiness Score', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                  Text(service['name'] ?? '', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: govNavy)),
                  const SizedBox(height: 25),

                  // Readiness dial visualization
                  Center(
                    child: Column(
                      children: [
                        Container(
                          width: 130,
                          height: 130,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: score >= 80 ? govEmerald : (score >= 50 ? Colors.amber : Colors.red),
                              width: 8,
                            ),
                          ),
                          child: Center(
                            child: Text(
                              '$score%',
                              style: TextStyle(
                                fontSize: 36,
                                fontWeight: FontWeight.bold,
                                color: score >= 80 ? govEmerald : (score >= 50 ? Colors.amber.shade900 : Colors.red),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          score >= 80 ? 'SUBMISSION READY' : 'CORRECTIONS REQUIRED',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: score >= 80 ? govEmerald : (score >= 50 ? Colors.amber.shade900 : Colors.red),
                            letterSpacing: 1,
                          ),
                        )
                      ],
                    ),
                  ),
                  const SizedBox(height: 25),
                  const Divider(),

                  const SizedBox(height: 15),
                  const Text('Required Documents Checklist:', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: govNavy)),
                  const SizedBox(height: 8),
                  ...docAnalysis.map((d) {
                    final status = d['status'];
                    final type = d['document_type'].toString().toUpperCase();
                    final isOk = d['is_verified'] == true && status == 'present';

                    return ListTile(
                      leading: Icon(
                        isOk ? Icons.check_circle : (status == 'missing' ? Icons.cancel : Icons.warning_amber),
                        color: isOk ? govEmerald : (status == 'missing' ? Colors.red : Colors.amber.shade900),
                      ),
                      title: Text(type, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                      subtitle: Text(
                        status == 'missing'
                            ? 'Not uploaded to Vault'
                            : (isOk ? 'Verified successfully' : 'Validation warnings present'),
                        style: const TextStyle(fontSize: 11),
                      ),
                    );
                  }).toList(),

                  if (issues.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    const Text('Remediation Items:', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.red)),
                    const SizedBox(height: 8),
                    ...issues.map((i) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4.0),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.arrow_right, color: Colors.red, size: 18),
                          Expanded(child: Text(i['message'].toString(), style: const TextStyle(fontSize: 12, height: 1.3))),
                        ],
                      ),
                    )).toList(),
                  ],

                  const SizedBox(height: 30),
                  ElevatedButton(
                    onPressed: score < 50
                        ? null
                        : () async {
                            Navigator.pop(context);
                            showDialog(
                              context: context,
                              barrierDismissible: false,
                              builder: (context) => const Center(child: CircularProgressIndicator()),
                            );
                            
                            // Auto-fill and submit
                            final autoFields = await ApiService.getAutoFillFields(service['id']);
                            autoFields['service_name'] = service['name'];
                            
                            final response = await ApiService.submitApplication({
                              'service_id': service['id'],
                              'form_data': autoFields,
                              'readiness_score': score,
                              'validation_report': {'issues': issues.map((i) => i['message']).toList()}
                            });

                            if (mounted) {
                              Navigator.pop(context); // Close loading dialog
                              _showReceiptDialog(response['pdf_download_url']);
                            }
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: govNavy,
                      minimumSize: const Size.fromHeight(50),
                    ),
                    child: const Text('Export Verified PDF Package', style: TextStyle(fontWeight: FontWeight.bold)),
                  )
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _showReceiptDialog(String downloadPath) {
    const Color govNavy = Color(0xFF0F294A);
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Application Package Generated', style: TextStyle(fontWeight: FontWeight.bold)),
        content: const Text(
          'Your smart government application package has been created successfully. All document vault certificates and validations have been compiled into a ready-to-submit PDF document.',
          style: TextStyle(fontSize: 13, height: 1.3),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('OK', style: TextStyle(fontWeight: FontWeight.bold, color: govNavy)),
          )
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const Color govNavy = Color(0xFF0F294A);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Government Services Catalog'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            // Search Bar
            TextFormField(
              controller: _searchController,
              decoration: InputDecoration(
                labelText: 'Search certificates, licenses, pensions...',
                prefixIcon: const Icon(Icons.search, color: govNavy),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onChanged: (val) => _loadServices(query: val),
            ),
            const SizedBox(height: 20),

            // Catalog list
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : ListView.builder(
                      itemCount: _services.length,
                      itemBuilder: (context, index) {
                        final s = _services[index];
                        return Card(
                          margin: const EdgeInsets.symmetric(vertical: 8),
                          child: ListTile(
                            title: Text(s['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                            subtitle: Text('Processing: ${s['processing_time']} | Fee: ₹${s['fees']}', style: const TextStyle(fontSize: 12)),
                            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                            onTap: () => _showServiceDetails(s),
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

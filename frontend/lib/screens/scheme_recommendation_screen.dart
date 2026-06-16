// scheme_recommendation_screen.dart - Welfare Schemes Recommendation Portal
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class SchemeRecommendationScreen extends StatefulWidget {
  const SchemeRecommendationScreen({super.key});

  @override
  State<SchemeRecommendationScreen> createState() => _SchemeRecommendationScreenState();
}

class _SchemeRecommendationScreenState extends State<SchemeRecommendationScreen> {
  bool _isLoading = true;
  List<dynamic> _recommendations = [];

  @override
  void initState() {
    super.initState();
    _loadRecommendations();
  }

  Future<void> _loadRecommendations() async {
    try {
      final data = await ApiService.getSchemeRecommendations();
      if (mounted) {
        setState(() {
          _recommendations = data;
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

  @override
  Widget build(BuildContext context) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govSaffron = Color(0xFFFF671F);
    const Color govEmerald = Color(0xFF046A38);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Welfare Scheme Matches'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Welfare benefits matched dynamically using your Digital Twin demographic and occupational parameters.',
                    style: TextStyle(color: Colors.grey, fontSize: 13, height: 1.3),
                  ),
                  const SizedBox(height: 20),

                  Expanded(
                    child: ListView.builder(
                      itemCount: _recommendations.length,
                      itemBuilder: (context, index) {
                        final rec = _recommendations[index];
                        final s = rec['scheme'];
                        final isEligible = rec['is_eligible'] == true;
                        final reasons = rec['reasons'] as List? ?? [];
                        final docs = s['required_documents'] as List? ?? [];

                        return Card(
                          margin: const EdgeInsets.symmetric(vertical: 8),
                          child: ExpansionTile(
                            leading: CircleAvatar(
                              backgroundColor: isEligible ? govEmerald.withOpacity(0.1) : Colors.amber.withOpacity(0.1),
                              child: Icon(
                                isEligible ? Icons.check_circle_outline : Icons.info_outline,
                                color: isEligible ? govEmerald : Colors.amber.shade900,
                              ),
                            ),
                            title: Text(
                              s['name'] ?? '',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: govNavy),
                            ),
                            subtitle: Text('Benefit: ${s['benefit_amount']}', style: const TextStyle(fontSize: 12)),
                            trailing: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: isEligible ? govEmerald.withOpacity(0.1) : Colors.grey[200],
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                isEligible ? 'ELIGIBLE' : 'NOT MATCHED',
                                style: TextStyle(
                                  color: isEligible ? govEmerald : Colors.grey[700],
                                  fontWeight: FontWeight.bold,
                                  fontSize: 10,
                                ),
                              ),
                            ),
                            children: [
                              Padding(
                                padding: const EdgeInsets.all(16.0),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Scheme Description:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                                    const SizedBox(height: 4),
                                    Text(s['description'] ?? '', style: const TextStyle(fontSize: 12, height: 1.3, color: Colors.black87)),
                                    const SizedBox(height: 12),
                                    
                                    const Text('Required Documents:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                                    const SizedBox(height: 4),
                                    Wrap(
                                      spacing: 6,
                                      children: docs.map((d) => Chip(
                                        label: Text(d.toString().toUpperCase(), style: const TextStyle(fontSize: 9, color: govNavy)),
                                        backgroundColor: govNavy.withOpacity(0.05),
                                        padding: EdgeInsets.zero,
                                      )).toList(),
                                    ),
                                    const SizedBox(height: 12),

                                    const Text('Matching Analysis Details:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                                    const SizedBox(height: 4),
                                    ...reasons.map((r) => Row(
                                      children: [
                                        Icon(
                                          isEligible ? Icons.check : Icons.close,
                                          color: isEligible ? govEmerald : Colors.red,
                                          size: 16,
                                        ),
                                        const SizedBox(width: 8),
                                        Expanded(child: Text(r.toString(), style: const TextStyle(fontSize: 12))),
                                      ],
                                    )).toList(),
                                  ],
                                ),
                              ),
                            ],
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

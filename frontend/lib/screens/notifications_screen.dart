// notifications_screen.dart - Citizen Smart Alerts & Notifications
import 'package:flutter/material.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govSaffron = Color(0xFFFF671F);
    const Color govEmerald = Color(0xFF046A38);

    // Mock high-fidelity notifications to show portal utility
    final List<Map<String, dynamic>> notifications = [
      {
        'title': 'Income Certificate Expiry Alert',
        'message': 'Your Income Certificate (INC2026...) expires on 31/03/2027. We recommend submitting a renewal request soon.',
        'time': '2 hours ago',
        'type': 'expiry',
        'color': govSaffron
      },
      {
        'title': 'New Scholarship Scheme Eligible!',
        'message': 'Based on your Digital Twin update (Engineering education), you are now eligible for the Post-Matric Scholarship Scheme. Benefit details: Full Tuition waiver.',
        'time': '1 day ago',
        'type': 'scheme',
        'color': govEmerald
      },
      {
        'title': 'Biometric Verification Ready',
        'message': 'Your submission package for Business License (Package ID: app_8236d8) is generated. You can now download the PDF package and visit MeeSeva Center Gachibowli.',
        'time': '3 days ago',
        'type': 'alert',
        'color': govNavy
      }
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Citizen Smart Alerts'),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(20),
        itemCount: notifications.length,
        itemBuilder: (context, index) {
          final n = notifications[index];
          final type = n['type'];

          return Card(
            margin: const EdgeInsets.symmetric(vertical: 8),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: (n['color'] as Color).withOpacity(0.1),
                child: Icon(
                  type == 'expiry'
                      ? Icons.warning_amber
                      : (type == 'scheme' ? Icons.card_membership : Icons.check_circle_outline),
                  color: n['color'] as Color,
                ),
              ),
              title: Text(
                n['title'] ?? '',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: govNavy),
              ),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 5),
                  Text(n['message'] ?? '', style: const TextStyle(fontSize: 12, height: 1.3)),
                  const SizedBox(height: 5),
                  Text(n['time'] ?? '', style: const TextStyle(color: Colors.grey, fontSize: 10)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

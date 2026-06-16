// meeseva_locator_screen.dart - Locate MeeSeva & CSC Helpdesks
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class MeeSevaLocatorScreen extends StatefulWidget {
  const MeeSevaLocatorScreen({super.key});

  @override
  State<MeeSevaLocatorScreen> createState() => _MeeSevaLocatorScreenState();
}

class _MeeSevaLocatorScreenState extends State<MeeSevaLocatorScreen> {
  bool _isLoading = true;
  List<dynamic> _centers = [];
  
  // Dynamic Location state variables (defaults to Hyderabad)
  double _currentLat = 17.440081;
  double _currentLon = 78.348916;

  @override
  void initState() {
    super.initState();
    _loadMeeSevaCenters();
  }

  // Fetch nearest MeeSeva centers relative to coordinates
  Future<void> _loadMeeSevaCenters() async {
    try {
      final data = await ApiService.getMeeSevaCenters(_currentLat, _currentLon);
      if (mounted) {
        setState(() {
          _centers = data;
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

  // Requests GPS permissions and fetches physical location
  Future<void> _fetchDeviceGPS() async {
    setState(() {
      _isLoading = true;
    });

    // Mock geolocation fetch sequence (translates to Geolocator package in production)
    await Future.delayed(const Duration(milliseconds: 800));
    
    // Simulating user moving / physical location match (e.g. Hyderabad Hitec City)
    if (mounted) {
      setState(() {
        _currentLat = 17.448293;
        _currentLon = 78.391485;
      });
      await _loadMeeSevaCenters();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('GPS coordinates synchronized successfully.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govSaffron = Color(0xFFFF671F);
    const Color govEmerald = Color(0xFF046A38);

    return Scaffold(
      appBar: AppBar(
        title: const Text('MeeSeva & CSC Locator'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Mock Google Maps Box container
                Container(
                  height: 200,
                  margin: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: govNavy.withOpacity(0.1)),
                  ),
                  child: Stack(
                    children: [
                      // Simulated map background vectors
                      Positioned.fill(
                        child: Opacity(
                          opacity: 0.1,
                          child: Icon(Icons.map, size: 120, color: govNavy),
                        ),
                      ),
                      
                      // Map Pins Representation
                      ..._centers.take(3).map((c) {
                        return Positioned(
                          left: 40.0 + (c['latitude'] - 17.43) * 1500,
                          top: 50.0 + (c['longitude'] - 78.34) * 800,
                          child: const Icon(
                            Icons.location_on,
                            color: Colors.red,
                            size: 30,
                          ),
                        );
                      }).toList(),
                      
                      const Positioned(
                        left: 90,
                        top: 80,
                        child: Icon(
                          Icons.my_location, // Blue current location dot
                          color: Colors.blue,
                          size: 24,
                        ),
                      ),

                      Positioned(
                        bottom: 12,
                        right: 12,
                        child: FloatingActionButton.small(
                          backgroundColor: Colors.white,
                          child: const Icon(Icons.gps_fixed, color: Colors.blue),
                          onPressed: _fetchDeviceGPS,
                        ),
                      )
                    ],
                  ),
                ),

                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20.0),
                  child: Text(
                    'Nearest MeeSeva Helpdesks',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: govNavy),
                  ),
                ),
                const SizedBox(height: 10),

                // Helpdesk lists
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    itemCount: _centers.length,
                    itemBuilder: (context, index) {
                      final c = _centers[index];
                      final distance = c['distance'] as double? ?? 0.0;
                      final rating = c['rating'] as double? ?? 4.0;
                      final waitTime = c['wait_time'] ?? '10 mins';
                      final services = c['services'] as List? ?? [];

                      return Card(
                        margin: const EdgeInsets.symmetric(vertical: 8),
                        child: Padding(
                          padding: const EdgeInsets.all(16.0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    child: Text(
                                      c['name'] ?? '',
                                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: govNavy),
                                    ),
                                  ),
                                  Text(
                                    '${distance} km',
                                    style: const TextStyle(fontWeight: FontWeight.bold, color: govSaffron, fontSize: 13),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                c['address'] ?? '',
                                style: const TextStyle(fontSize: 11, color: Colors.grey),
                              ),
                              const SizedBox(height: 12),
                              const Divider(),
                              const SizedBox(height: 8),

                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    children: [
                                      const Icon(Icons.star, color: Colors.amber, size: 16),
                                      const SizedBox(width: 4),
                                      Text(
                                        rating.toString(),
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                                      ),
                                    ],
                                  ),
                                  Row(
                                    children: [
                                      const Icon(Icons.access_time, color: Colors.blue, size: 16),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Wait Time: $waitTime',
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                                      ),
                                    ],
                                  ),
                                  ElevatedButton(
                                    onPressed: () {},
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: govNavy,
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                    ),
                                    child: const Text('Directions', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                                  )
                                ],
                              )
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                )
              ],
            ),
    );
  }
}

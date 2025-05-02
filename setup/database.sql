CREATE TABLE `cdrs` (
  `cust_id` int(4) NOT NULL,
  `id` varchar(10) COLLATE utf8_unicode_ci NOT NULL,
  `seq` int(6) NOT NULL,
  `added_dt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `caller_id` varchar(15) COLLATE utf8_unicode_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


ALTER TABLE `cdrs`
  ADD PRIMARY KEY (`cust_id`,`id`,`seq`),
  ADD KEY `seq` (`seq`),
  ADD KEY `id` (`id`),
  ADD KEY `cust_id` (`cust_id`),
  ADD KEY `start_time` (`start_time`);